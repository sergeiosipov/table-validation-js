/*!
 * table-validation v1.2.0 — schema-driven table validation & comparison engine,
 * with config authoring (configModel/createConfigBuilder), ingestion (ingest),
 * and inference (inferConfig) tooling.
 * Implements: Table Validation Library — Core Specification v1.2.0 + Authoring,
 * Ingestion & Inference Addendum v1.2.0 (Browser JS profile v1.2.0).
 * Single-file vanilla ES2020 IIFE. No dependencies bundled; reads globalThis.luxon /
 * globalThis.ExcelJS at call time only. License: MIT.
 */
(function (global) {
    'use strict';

    const VERSION = '1.2.0';
    const SPEC_VERSION = '1.2.0';

    // ================================================================
    // Errors & signals
    // ================================================================

    class TableValidationConfigError extends Error {
        constructor(message) {
            super(message);
            this.name = 'TableValidationConfigError';
        }
    }

    // Termination signals (Core §2.2). ABORT carries an abortReason; STOP is a fail-fast/breaker stop.
    const ABORT = { __tv: 'abort' };          // intrinsic abort recorded (aborted:true)
    const STOP = { __tv: 'stop' };            // maxErrors / stopPolicy fail-fast stop

    // schema-content failure marker (Phase 1) — converted to a schemaValidationError abort
    function schemaFail(path, expected, actual) {
        throw { __tvSchemaFail: { path, expected, actual } };
    }

    // Accumulate-or-throw harness for Phase 1 (Addendum §A.4). The engines run in
    // throw mode: the first violation propagates and the run aborts (fast path,
    // exactly one schemaValidationError per run). The builder installs a collector:
    // each independent check unit records its first violation and validation
    // continues with the next unit, so authoring surfaces every independent defect
    // in one pass. Within one unit, later checks may depend on earlier ones, so a
    // unit stops at its first violation (cascade suppression, not exhaustiveness loss).
    let p1Collector = null;
    function p1unit(fn) {
        if (p1Collector === null) { fn(); return; }
        try { fn(); } catch (e) {
            if (e && e.__tvSchemaFail) p1Collector.push(e.__tvSchemaFail);
            else throw e;
        }
    }
    function collectPhase1Errors(fn) {
        const prev = p1Collector;
        p1Collector = [];
        try { fn(); } catch (e) {
            if (e && e.__tvSchemaFail) p1Collector.push(e.__tvSchemaFail);
            else { p1Collector = prev; throw e; }
        }
        const out = p1Collector;
        p1Collector = prev;
        return out;
    }

    // ================================================================
    // Small utilities
    // ================================================================

    const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    const isStr = (v) => typeof v === 'string';
    const isBool = (v) => typeof v === 'boolean';
    const isNum = (v) => typeof v === 'number' && !Number.isNaN(v);
    const isIntN = (v) => typeof v === 'number' && Number.isInteger(v);
    const isNonNegInt = (v) => isIntN(v) && v >= 0;

    const INT_RE = /^[+-]?[0-9]+$/;
    const FLOAT_RE = /^[+-]?[0-9]+(\.[0-9]+)?$/;
    const TPN_RE = /^T([+-]\d+)?$/;
    const SEMVER_RE = /^\d+\.\d+\.\d+$/;
    const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
    const TIME_STR_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?$/;

    const SEVERITIES = ['error', 'warning'];            // Core §2.1 — exactly two severities
    const SEV_RANK = { error: 0, warning: 1 };
    const PHASES = ['schemaValidation', 'schemaResolution', 'structuralColumnChecks',
        'structuralRowChecks', 'cellValidation', 'columnAggregateChecks',
        'rowCrossColumnChecks', 'tableChecks',
        'structuralComparison', 'cellComparison', 'comparisonChecks'];  // last 3: compare() only
    const TYPE_NAMES = ['string', 'int', 'float', 'bool', 'datetime', 'date', 'time', 'categorical', 'skip'];
    const TEMPORAL = { datetime: true, date: true, time: true };
    const COMP_OPS = ['<', '<=', '==', '!=', '>=', '>'];
    // F2: structural rules whose severity is configurable via structure.severities (default error;
    // duplicateColumnName default warning). columnCountBreach/rowCountBreach are _table-scoped.
    const STRUCT_SEV_RULES = ['columnCountBreach', 'extraColumn', 'columnOrderViolation',
        'rowCountBreach', 'allNullRow', 'duplicateRow', 'duplicateColumnName'];

    // canonical string conversion (Core §1.5): shortest round-tripping decimal via String()
    function canonical(v) {
        if (v === null || v === undefined) return 'null';
        if (typeof v === 'string') return v;
        if (typeof v === 'number' || typeof v === 'boolean') return String(v);
        try { return JSON.stringify(v); } catch (_) { return String(v); }
    }

    // string length in Unicode code points (Core §6.1)
    function cpLength(s) {
        let n = 0;
        for (const _ of s) n++;
        return n;
    }

    // lexicographic comparison by code point (Core §7.1 comparison for strings)
    function cpCompare(a, b) {
        const ia = a[Symbol.iterator](), ib = b[Symbol.iterator]();
        for (;;) {
            const na = ia.next(), nb = ib.next();
            if (na.done && nb.done) return 0;
            if (na.done) return -1;
            if (nb.done) return 1;
            const ca = na.value.codePointAt(0), cb = nb.value.codePointAt(0);
            if (ca !== cb) return ca < cb ? -1 : 1;
        }
    }

    // StringMatchStrategy application (Core §3.2): trim → stripSpaces → case
    function applyStrategy(s, st) {
        let v = s;
        if (st.trim) v = v.replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' ');
        if (st.stripSpaces) v = v.replace(/\s+/g, '');
        if (!st.caseSensitive) v = v.toLowerCase();
        return v;
    }

    // NumberFormat interpretation (Core §3.5, 6 steps) → { value, precision } | null
    function interpretNumberFormat(str, fmt, intContext) {
        let w = str;
        for (const g of (fmt.groupingSeparators || [])) w = w.split(g).join('');
        if (fmt.decimalSeparator != null) {
            const first = w.indexOf(fmt.decimalSeparator);
            if (first !== -1) {
                if (w.indexOf(fmt.decimalSeparator, first + fmt.decimalSeparator.length) !== -1) return null;
                w = w.slice(0, first) + '.' + w.slice(first + fmt.decimalSeparator.length);
            }
        }
        if (!(intContext ? INT_RE : FLOAT_RE).test(w)) {
            // §3.5 bare decimal (1.2.0, opt-in): ".85" → working copy "0.85"; never in int contexts
            if (intContext || fmt.allowBareDecimal !== true || !/^[+-]?\.[0-9]+$/.test(w)) return null;
            w = (w[0] === '+' || w[0] === '-') ? w[0] + '0' + w.slice(1) : '0' + w;
        }
        const value = Number(w);
        const dot = w.indexOf('.');
        return { value, precision: dot === -1 ? 0 : w.length - dot - 1 };
    }

    function inRange(v, min, max, minInc, maxInc) {
        if (min != null && (minInc ? v < min : v <= min)) return false;
        if (max != null && (maxInc ? v > max : v >= max)) return false;
        return true;
    }

    // Assign an own data property. A plain `o[k] = v` would trigger the Object.prototype
    // "__proto__" setter for that key — corrupting the clone's prototype instead of
    // copying data. defineProperty writes the own key regardless (pollution hardening).
    function setOwn(o, k, v) {
        if (k === '__proto__') {
            Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
        } else {
            o[k] = v;
        }
    }

    function jsonClone(v) {
        if (v === null || typeof v !== 'object') return v;
        if (Array.isArray(v)) return v.map(jsonClone);
        const o = {};
        for (const k of Object.keys(v)) setOwn(o, k, jsonClone(v[k]));
        return o;
    }

    // F1: resolve a Severity value ("error"|"warning" | {default, byRule}) for a given ruleName.
    function resolveSev(spec, ruleName) {
        if (isObj(spec)) {
            if (spec.byRule && spec.byRule[ruleName] !== undefined) return spec.byRule[ruleName];
            return spec.default !== undefined ? spec.default : 'error';
        }
        return spec !== undefined ? spec : 'error';
    }

    function validYmd(y, m, d) {
        if (m < 1 || m > 12 || d < 1) return false;
        const dim = [31, ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 29 : 28,
            31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        return d <= dim[m - 1];
    }

    const dateKey = (y, m, d) => y * 10000 + m * 100 + d;

    function parseIsoDateKey(s) {
        const m = ISO_DATE_RE.exec(s);
        if (!m) return null;
        const y = +m[1], mo = +m[2], d = +m[3];
        return validYmd(y, mo, d) ? dateKey(y, mo, d) : null;
    }

    function parseTimeMsod(s) {
        const m = TIME_STR_RE.exec(s);
        if (!m) return null;
        return (+m[1]) * 3600000 + (+m[2]) * 60000 + (m[3] ? +m[3] : 0) * 1000 +
            (m[4] ? +(m[4].padEnd(3, '0')) : 0);
    }

    // ================================================================
    // Host bindings: Luxon (lazy)
    // ================================================================

    function getLuxon() {
        const l = global.luxon;
        if (!l) {
            throw new TableValidationConfigError(
                'The Luxon global (globalThis.luxon) is required for temporal evaluation but is not loaded.');
        }
        return l;
    }

    // "utc" → "utc", "local" → "system", else IANA (JS spec §4.2)
    const zoneName = (tz) => tz === 'utc' ? 'utc' : (tz === 'local' ? 'system' : tz);

    function isValidZoneString(tz) {
        if (tz === 'utc' || tz === 'local') return true;
        const l = global.luxon;
        if (l && l.IANAZone) return l.IANAZone.isValidZone(tz);
        try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch (_) { return false; }
    }

    // Temporal format token scanning (Core §13.3 normative token table).
    // Tokens (longest first for greedy decomposition of alpha runs — 'MM' before 'M',
    // 'dd' before 'd', per the §13.3 decomposition rule added in 1.1.0).
    const FMT_TOKENS = ['yyyy', 'SSS', 'yy', 'MM', 'dd', 'HH', 'hh', 'mm', 'ss', 'ZZ', 'a', 'M', 'd'];

    // → array of token names, or null when the format is invalid
    function scanFormatTokens(fmt) {
        const tokens = [];
        let i = 0;
        while (i < fmt.length) {
            const c = fmt[i];
            if (c === "'") {                       // quoted literal '...'
                const end = fmt.indexOf("'", i + 1);
                if (end === -1) return null;
                i = end + 1;
            } else if (/[A-Za-z]/.test(c)) {       // alpha run → greedy token decomposition
                let j = i;
                while (j < fmt.length && /[A-Za-z]/.test(fmt[j])) j++;
                let run = fmt.slice(i, j);
                while (run.length) {
                    const t = FMT_TOKENS.find((tk) => run.startsWith(tk));
                    if (!t) return null;
                    tokens.push(t);
                    run = run.slice(t.length);
                }
                i = j;
            } else {
                i++;                                // literal separator character
            }
        }
        return tokens;
    }

    // ================================================================
    // Message templates (Core §9.3, normative English defaults)
    // ================================================================

    const bound = (v) => v == null ? '∞' : String(v);
    const rngTxt = (c) => `${bound(c.min)}–${bound(c.max)}`;
    const fmtVal = (v) => typeof v === 'string' ? JSON.stringify(v) : canonical(v);

    function renderMessage(ruleName, ctx, templates) {
        const ci = ruleName.indexOf(':');
        const base = ci === -1 ? ruleName : ruleName.slice(0, ci);
        const n = ci === -1 ? '' : ruleName.slice(ci + 1);
        // F4: host template override — templates[ruleName] or templates[base], a fn (ctx, {ruleName,n}) → string
        if (templates) {
            const t = templates[ruleName] !== undefined ? templates[ruleName] : templates[base];
            if (typeof t === 'function') return t(ctx, { ruleName, base, n });
            if (typeof t === 'string') return t;
        }
        switch (base) {
            case 'headersMissing': return 'Table has no header row but column matching is "byName"';
            case 'columnCountBreach': return `${ctx.actual} columns; expected ${rngTxt(ctx)}`;
            case 'rowCountBreach': return `${ctx.actual} rows; expected ${rngTxt(ctx)}`;
            case 'duplicateColumnName': return `Duplicate header ×${ctx.occurrences}; strategy "${ctx.strategy}" applied`;
            case 'requiredColumnMissing':
                return ctx.expectedPosition != null
                    ? `Required column missing at position ${ctx.expectedPosition}`
                    : 'Required column is missing';
            case 'extraColumn': return `Unexpected extra column at position ${ctx.position}`;
            case 'columnOrderViolation': return `Column at position ${ctx.actualPosition}; expected ${ctx.expectedPosition}`;
            case 'allNullColumn': return 'Every value in the column is null';
            case 'duplicateColumnContent': return `Column content identical to "${ctx.duplicateOfColumn}"`;
            case 'allNullRow': return 'Every value in the row is null';
            case 'duplicateRow': return `Duplicate of row ${ctx.duplicateOfRow + 1}`;
            case 'nullabilityViolation': return 'Null value in non-nullable column';
            case 'typeMismatch': return `Expected ${ctx.expectedType}, got ${ctx.actualType}`;
            case 'rangeBreach': return `${ctx.constraint} out of range ${rngTxt(ctx)}`;
            case 'regexMismatch': return `Value does not match pattern /${ctx.regex}/${ctx.regexFlags || ''}`;
            case 'categoryMismatch': return 'Value not in the allowed set';
            case 'uniquenessViolation':
                return ctx.duplicateOfRow == null ? 'Duplicate value'
                    : `Duplicate value; first at row ${ctx.duplicateOfRow + 1}`;
            case 'compositeKeyViolation': return `Duplicate key (${ctx.keyColumns.join(', ')})`;
            case 'compositeKeyNullViolation': return `Null in key column (${ctx.keyColumns.join(', ')})`;
            case 'comparison': return `Rule "${n}": ${ctx.fieldA} ${ctx.op} ${ctx.fieldB} violated`;
            case 'conditionalRequired':
                return `Rule "${n}": ${ctx.thenField} required when ${ctx.ifField} ${ctx.ifOp} ${fmtVal(ctx.ifValue)}`;
            case 'nonNullCount':
                return `Rule "${n}": ${ctx.actual} of ${ctx.fields.join(', ')} filled; expected exactly ${ctx.expected}`;
            case 'cooccurrence':
                return `Rule "${n}": fields must be filled together; missing ${ctx.missingFields.join(', ')}`;
            case 'monotonic': return `Rule "${n}": breaks ${ctx.direction} order`;
            case 'sequenceNoGaps':
                if (ctx.kind === 'gap') return `Rule "${n}": missing value ${ctx.expectedValue} in sequence`;
                if (ctx.kind === 'duplicate') return `Rule "${n}": duplicate sequence value ${ctx.actualValue}`;
                return `Rule "${n}": value below sequence start`;
            case 'sumEquals':
                return `Rule "${n}": sum ${ctx.actualSum} ≠ expected ${ctx.expectedSum} (±${ctx.tolerance})`;
            case 'custom': return ctx.userMessage != null ? ctx.userMessage : `Check "${n}" failed`;
            case 'customFunctionError': return `Check "${n}" crashed: ${ctx.errorMessage}`;
            case 'customFunctionContractViolation': return `Check "${n}" returned duplicate results for ${ctx.duplicateKey}`;
            case 'schemaValidationError': return `Schema error at ${ctx.path}: expected ${ctx.expected}, got ${fmtVal(ctx.actual)}`;
            case 'irrelevantSetting': return `Setting ${ctx.setting} has no effect: ${ctx.reason}`;
            default: return ruleName;
        }
    }

    // ================================================================
    // Recorder — running fixed-memory aggregation (Core §8.10)
    // ================================================================

    function makeRecorder(cfg, render) {
        render = render || renderMessage;
        const bySeverity = { error: 0, warning: 0 };
        const byPhase = {};
        for (const p of PHASES) byPhase[p] = 0;
        const byColumn = Object.create(null);
        const groups = new Map();
        const groupList = [];
        const register = cfg.collectCellRegister ? [] : null;
        const state = {
            truncated: false, truncationReason: null, truncatedColumns: [],
            aborted: false, abortReason: null, errCount: 0,
        };

        // one call = ONE violation, possibly multiple entries.
        // abortReason (string) → intrinsic/policy abort: record at `error` then set aborted + throw.
        function record(phase, severity, ruleName, entries, abortReason) {
            bySeverity[severity]++;
            byPhase[phase]++;
            const counts = severity === 'error' &&
                phase !== 'schemaValidation' && phase !== 'schemaResolution';
            if (counts) state.errCount++;

            for (const e of entries) {
                const ctx = e.context || {};
                const msg = render(ruleName, ctx);
                const colKey = e.field != null ? e.field : '_table';
                let cc = byColumn[colKey];
                if (!cc) cc = byColumn[colKey] = { error: 0, warning: 0 };
                cc[severity]++;

                const gkey = severity + '\u0001' + ruleName + '\u0001' + (e.field == null ? '\u0000' : e.field);
                let g = groups.get(gkey);
                if (!g) {
                    g = {
                        severity, phase, ruleName,
                        fieldName: e.field == null ? null : e.field,
                        message: msg, context: ctx,
                        count: 0, firstRow: null, rowBuf: [], freq: new Map(),
                    };
                    groups.set(gkey, g);
                    groupList.push(g);
                }
                g.count++;
                if (e.row != null) {
                    if (g.firstRow == null || e.row < g.firstRow) g.firstRow = e.row;
                    if (g.rowBuf.length < cfg.maxSamples) g.rowBuf.push(e.row);
                }
                if ('value' in e) {
                    const s = canonical(e.value);
                    g.freq.set(s, (g.freq.get(s) || 0) + 1);
                }
                if (register) {
                    register.push({
                        row: e.row == null ? null : e.row,
                        field: e.field == null ? null : e.field,
                        severity, ruleName,
                        value: 'value' in e ? e.value : null,
                        message: msg, context: ctx,
                    });
                }
            }

            if (abortReason != null) {                          // intrinsic abort or stopOnFail
                state.aborted = true;
                state.abortReason = abortReason;
                throw ABORT;
            }
            if (counts) {                                       // fail-fast policy / breaker (error only)
                if (cfg.stopPolicy === 'firstError') {
                    state.aborted = true;
                    state.abortReason = 'stopPolicy';
                    throw ABORT;
                }
                if (cfg.maxErrors != null && state.errCount >= cfg.maxErrors) {
                    state.truncated = true;
                    state.truncationReason = 'maxErrors';
                    throw STOP;
                }
            }
        }

        function markColumnTruncated(name) {
            state.truncated = true;
            if (state.truncationReason == null) state.truncationReason = 'maxErrorsPerColumn';
            if (!state.truncatedColumns.includes(name)) state.truncatedColumns.push(name);
        }

        function finalize(meta) {
            const details = groupList.map((g) => {
                const freq = [...g.freq.entries()]
                    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
                    .slice(0, cfg.maxSamples)
                    .map(([value, frequency]) => ({ value, frequency }));
                return {
                    severity: g.severity, phase: g.phase, ruleName: g.ruleName,
                    fieldName: g.fieldName, message: g.message, context: g.context,
                    count: g.count, firstOccurrenceRow: g.firstRow,
                    topSampleValues: freq, topSampleRows: g.rowBuf.slice(0, cfg.maxSamples),
                };
            });
            const byCol = {};
            for (const k of Object.keys(byColumn)) byCol[k] = Object.assign({}, byColumn[k]);
            const valid = bySeverity.error === 0;
            const summary = {
                rowsChecked: meta.rowsChecked,
                columnsChecked: meta.columnsChecked,
                bySeverity: Object.assign({}, bySeverity),
                byPhase: Object.assign({}, byPhase),
                byColumn: byCol,
                truncatedColumns: state.truncatedColumns.slice(),
                details,
            };
            if (meta.columnMatching !== undefined) summary.columnMatching = meta.columnMatching;
            if (meta.summaryExtra) Object.assign(summary, meta.summaryExtra);
            const out = {
                specVersion: SPEC_VERSION,
                valid,
                validWithWarnings: valid && bySeverity.warning > 0,
                aborted: state.aborted,
                abortReason: state.abortReason,
                truncated: state.truncated,
                truncationReason: state.truncationReason,
                summary,
                cellRegister: register,
                cellObservations: meta.cellObservations || null,
            };
            if (meta.extra) Object.assign(out, meta.extra);      // comparison adds diff, engine, etc.
            return out;
        }

        return { record, markColumnTruncated, finalize, state };
    }

    // ================================================================
    // Phase 1 — schema self-validation (Core §10, rules 1–52)
    // ================================================================

    function effStrategy(raw, defs) {
        const o = isObj(raw) ? raw : {};
        return {
            caseSensitive: o.caseSensitive != null ? o.caseSensitive : defs[0],
            trim: o.trim != null ? o.trim : defs[1],
            stripSpaces: o.stripSpaces != null ? o.stripSpaces : defs[2],
        };
    }

    function checkStrategyShape(o, path) {                                 // rule 10
        if (!isObj(o)) schemaFail(path, 'StringMatchStrategy object', o);
        for (const k of ['caseSensitive', 'trim', 'stripSpaces']) {
            if (o[k] !== undefined && !isBool(o[k])) schemaFail(`${path}.${k}`, 'boolean', o[k]);
        }
    }

    function checkNumberFormatShape(f, path) {                             // rule 12
        if (!isObj(f)) schemaFail(path, 'NumberFormat object', f);
        const bad = (c) => c.length !== 1 || /[0-9+-]/.test(c);
        const ds = f.decimalSeparator === undefined ? null : f.decimalSeparator;
        if (ds !== null) {
            if (!isStr(ds) || bad(ds)) {
                schemaFail(`${path}.decimalSeparator`, 'single non-digit, non-sign character or null', ds);
            }
        }
        const gs = f.groupingSeparators === undefined ? [] : f.groupingSeparators;
        if (!Array.isArray(gs)) schemaFail(`${path}.groupingSeparators`, 'array of characters', gs);
        const seen = new Set();
        for (let i = 0; i < gs.length; i++) {
            const g = gs[i];
            if (!isStr(g) || bad(g)) {
                schemaFail(`${path}.groupingSeparators[${i}]`, 'single non-digit, non-sign character', g);
            }
            if (seen.has(g) || g === ds) {
                schemaFail(`${path}.groupingSeparators[${i}]`, 'distinct separator characters', g);
            }
            seen.add(g);
        }
        if (f.allowBareDecimal !== undefined) {                            // rule 12 (1.2.0)
            if (!isBool(f.allowBareDecimal)) {
                schemaFail(`${path}.allowBareDecimal`, 'boolean', f.allowBareDecimal);
            }
            if (f.allowBareDecimal === true && ds === null) {
                schemaFail(`${path}.allowBareDecimal`, 'a non-null decimalSeparator when allowBareDecimal is true', f.allowBareDecimal);
            }
        }
    }

    // kind: 'count' | 'number' | 'intSafe' | 'datetime' | 'date' | 'time'
    function checkRangeShape(r, path, kind) {                              // rules 11, 13–17, 52
        if (!isObj(r)) schemaFail(path, 'Range object', r);
        for (const k of ['min', 'max', 'minInclusive', 'maxInclusive']) {
            if (!(k in r)) schemaFail(`${path}.${k}`, 'Range key present (min, max, minInclusive, maxInclusive)', undefined);
        }
        if (!isBool(r.minInclusive)) schemaFail(`${path}.minInclusive`, 'boolean', r.minInclusive);
        if (!isBool(r.maxInclusive)) schemaFail(`${path}.maxInclusive`, 'boolean', r.maxInclusive);

        const checkBound = (v, bp) => {
            if (v === null) return null;
            if (kind === 'count') {
                if (!isNonNegInt(v)) schemaFail(bp, 'non-negative integer or null', v);
                return v;
            }
            if (kind === 'number') {
                if (!isNum(v)) schemaFail(bp, 'number or null', v);
                return v;
            }
            if (kind === 'intSafe') {
                if (!isNum(v) || !Number.isSafeInteger(v)) schemaFail(bp, 'integral number in the safe range or null', v);
                return v;
            }
            if (kind === 'time') {
                if (!isStr(v) || parseTimeMsod(v) == null) schemaFail(bp, 'time string (HH:mm[:ss[.SSS]]) or null', v);
                return parseTimeMsod(v);
            }
            // date / datetime: ISO string or T+/-N
            if (!isStr(v)) schemaFail(bp, 'ISO string, T+/-N, or null', v);
            if (TPN_RE.test(v)) return { t: v === 'T' ? 0 : parseInt(v.slice(1), 10) };
            if (kind === 'date') {
                const k = parseIsoDateKey(v);
                if (k == null) schemaFail(bp, 'ISO date string (yyyy-MM-dd) or T+/-N or null', v);
                return k;
            }
            // datetime
            const l = getLuxon();
            const dt = l.DateTime.fromISO(v, { zone: 'utc' });
            if (!dt.isValid) schemaFail(bp, 'ISO datetime string or T+/-N or null', v);
            return dt.toMillis();
        };

        const mn = checkBound(r.min, `${path}.min`);
        const mx = checkBound(r.max, `${path}.max`);
        if (mn != null && mx != null) {                                    // rule 13
            const bothT = isObj(mn) && isObj(mx);
            const bothAbs = !isObj(mn) && !isObj(mx);
            if (bothT || bothAbs) {
                const a = bothT ? mn.t : mn, b = bothT ? mx.t : mx;
                const ok = (r.minInclusive && r.maxInclusive) ? a <= b : a < b;
                if (!ok) schemaFail(path, 'min <= max (or min < max for exclusive bounds)', { min: r.min, max: r.max });
            }
        }
    }

    const COMPARISON_CLASS = { int: 'number', float: 'number', string: 'string', datetime: 'datetime', date: 'date', time: 'time' };

    function validateSchemaPhase1(schema, functions) {
        // ---- meta (rule 1)
        p1unit(() => { if (!isObj(schema.meta)) schemaFail('meta', 'object', schema.meta); });
        if (isObj(schema.meta)) {
            p1unit(() => {
                if (!isStr(schema.meta.schemaVersion) || !SEMVER_RE.test(schema.meta.schemaVersion)) {
                    schemaFail('meta.schemaVersion', 'semver string (e.g. "1.2.0")', schema.meta.schemaVersion);
                }
            });
            p1unit(() => {
                if (!isStr(schema.meta.name) || schema.meta.name.length === 0) {
                    schemaFail('meta.name', 'non-empty string', schema.meta.name);
                }
            });
            p1unit(() => {
                if (schema.meta.description !== undefined && !isStr(schema.meta.description)) {
                    schemaFail('meta.description', 'string', schema.meta.description);
                }
            });
        }

        // ---- resultConfig (rules 9, 49–51)
        if (schema.resultConfig !== undefined) {
            const rc = schema.resultConfig;
            p1unit(() => { if (!isObj(rc)) schemaFail('resultConfig', 'object', rc); });
            if (isObj(rc)) {
                p1unit(() => {
                    if (rc.maxSamples !== undefined && !(isIntN(rc.maxSamples) && rc.maxSamples >= 1)) {
                        schemaFail('resultConfig.maxSamples', 'integer >= 1', rc.maxSamples);
                    }
                });
                for (const k of ['maxErrors', 'maxErrorsPerColumn']) {
                    p1unit(() => {
                        if (rc[k] !== undefined && rc[k] !== null && !(isIntN(rc[k]) && rc[k] >= 1)) {
                            schemaFail(`resultConfig.${k}`, 'integer >= 1 or null', rc[k]);
                        }
                    });
                }
                p1unit(() => {
                    if (rc.collectCellRegister !== undefined && !isBool(rc.collectCellRegister)) {
                        schemaFail('resultConfig.collectCellRegister', 'boolean', rc.collectCellRegister);
                    }
                });
                p1unit(() => {
                    if (rc.collectCellObservations !== undefined && !isBool(rc.collectCellObservations)) {  // rule 56
                        schemaFail('resultConfig.collectCellObservations', 'boolean', rc.collectCellObservations);
                    }
                });
                p1unit(() => {
                    if (rc.stopPolicy !== undefined && rc.stopPolicy !== 'never' && rc.stopPolicy !== 'firstError') {
                        schemaFail('resultConfig.stopPolicy', '"never" or "firstError"', rc.stopPolicy);
                    }
                });
            }
        }

        // ---- nullHandling (rule 2)
        if (schema.nullHandling !== undefined) {
            p1unit(() => {
                if (!isObj(schema.nullHandling)) schemaFail('nullHandling', 'object', schema.nullHandling);
                const ne = schema.nullHandling.nullEquivalents;
                if (ne !== undefined && !(Array.isArray(ne) && ne.every(isStr))) {
                    schemaFail('nullHandling.nullEquivalents', 'array of strings', ne);
                }
            });
        }

        // ---- evaluation (rules 3, 4)
        if (schema.evaluation !== undefined) {
            const ev = schema.evaluation;
            p1unit(() => { if (!isObj(ev)) schemaFail('evaluation', 'object', ev); });
            if (isObj(ev)) {
                p1unit(() => {
                    if (ev.strictType !== undefined && !isBool(ev.strictType)) {
                        schemaFail('evaluation.strictType', 'boolean', ev.strictType);
                    }
                });
                p1unit(() => {
                    if (ev.timezone !== undefined) {
                        if (!isStr(ev.timezone)) schemaFail('evaluation.timezone', 'string', ev.timezone);
                        if (!isValidZoneString(ev.timezone)) {
                            schemaFail('evaluation.timezone', '"utc", "local", or a valid IANA zone name', ev.timezone);
                        }
                    }
                });
            }
        }

        // ---- structure (rules 5, 6, 44)
        const st = schema.structure !== undefined ? schema.structure : {};
        p1unit(() => { if (!isObj(st)) schemaFail('structure', 'object', st); });
        if (isObj(st)) {
            p1unit(() => {
                if (st.columnMatching !== undefined && st.columnMatching !== 'byName' && st.columnMatching !== 'byPosition') {
                    schemaFail('structure.columnMatching', '"byName" or "byPosition"', st.columnMatching);
                }
            });
            p1unit(() => { if (st.fieldNameMatching !== undefined) checkStrategyShape(st.fieldNameMatching, 'structure.fieldNameMatching'); });
            p1unit(() => { if (st.rowCount !== undefined) checkRangeShape(st.rowCount, 'structure.rowCount', 'count'); });
            p1unit(() => { if (st.columnCount !== undefined) checkRangeShape(st.columnCount, 'structure.columnCount', 'count'); });
            for (const k of ['allowDuplicateRows', 'allowAllNullRows', 'allowDuplicateColumns',
                'allowAllNullColumns', 'allowExtraColumns', 'allowMissingColumns', 'enforceColumnOrder']) {
                p1unit(() => {
                    if (st[k] !== undefined && !isBool(st[k])) schemaFail(`structure.${k}`, 'boolean', st[k]);
                });
            }
            if (st.duplicateColumnNames !== undefined) {
                const d = st.duplicateColumnNames;
                p1unit(() => { if (!isObj(d)) schemaFail('structure.duplicateColumnNames', 'object', d); });
                if (isObj(d)) {
                    p1unit(() => {
                        if (d.strategy !== undefined && !['rename', 'halt', 'keepFirst'].includes(d.strategy)) {
                            schemaFail('structure.duplicateColumnNames.strategy', '"rename", "halt", or "keepFirst"', d.strategy);
                        }
                    });
                    p1unit(() => {
                        if (d.renamePattern !== undefined) {
                            if (!isStr(d.renamePattern) || !d.renamePattern.includes('{name}') || !d.renamePattern.includes('{index}')) {
                                schemaFail('structure.duplicateColumnNames.renamePattern',
                                    'string containing "{name}" and "{index}"', d.renamePattern);   // rule 44
                            }
                        }
                    });
                }
            }
            if (st.duplicateDetection !== undefined) {
                p1unit(() => {
                    if (!isObj(st.duplicateDetection)) schemaFail('structure.duplicateDetection', 'object', st.duplicateDetection);
                    if (st.duplicateDetection.matchStrategy !== undefined) {
                        checkStrategyShape(st.duplicateDetection.matchStrategy, 'structure.duplicateDetection.matchStrategy');
                    }
                });
            }
            if (st.severities !== undefined) {                                          // rule 55
                p1unit(() => { if (!isObj(st.severities)) schemaFail('structure.severities', 'object', st.severities); });
                if (isObj(st.severities)) {
                    for (const rn of Object.keys(st.severities)) {
                        p1unit(() => {
                            if (!STRUCT_SEV_RULES.includes(rn)) {
                                schemaFail(`structure.severities.${rn}`, `a structural rule name (${STRUCT_SEV_RULES.join(', ')})`, rn);
                            }
                            if (!SEVERITIES.includes(st.severities[rn])) {
                                schemaFail(`structure.severities.${rn}`, '"error" or "warning"', st.severities[rn]);
                            }
                        });
                    }
                }
            }
        }

        // ---- columns (rules 7, 18–26)
        p1unit(() => {
            if (!isObj(schema.columns) || Object.keys(schema.columns).length === 0) {
                schemaFail('columns', 'object with at least one column', schema.columns);
            }
        });
        const colNames = isObj(schema.columns) ? Object.keys(schema.columns) : [];
        const colTypes = {};

        for (const name of colNames) {
            const p = `columns.${name}`;
            const def = schema.columns[name];
            p1unit(() => { if (!isObj(def)) schemaFail(p, 'column definition object', def); });
            if (!isObj(def)) continue;
            p1unit(() => {
                if (def.required !== undefined && def.required !== null && !isBool(def.required)) {
                    schemaFail(`${p}.required`, 'true, false, or null', def.required);
                }
            });
            p1unit(() => {
                if (def.nullable !== undefined && !isBool(def.nullable)) schemaFail(`${p}.nullable`, 'boolean', def.nullable);
            });
            if (def.severity !== undefined) {                                        // rule 53 (per-rule form)
                p1unit(() => {
                    const sv = def.severity;
                    if (isObj(sv)) {
                        if (sv.default !== undefined && !SEVERITIES.includes(sv.default)) {
                            schemaFail(`${p}.severity.default`, '"error" or "warning"', sv.default);
                        }
                        if (sv.byRule !== undefined) {
                            if (!isObj(sv.byRule)) schemaFail(`${p}.severity.byRule`, 'object', sv.byRule);
                            for (const rn of Object.keys(sv.byRule)) {
                                if (!SEVERITIES.includes(sv.byRule[rn])) {
                                    schemaFail(`${p}.severity.byRule.${rn}`, '"error" or "warning"', sv.byRule[rn]);
                                }
                            }
                        }
                    } else if (!SEVERITIES.includes(sv)) {
                        schemaFail(`${p}.severity`, '"error", "warning", or a {default, byRule} object', sv);
                    }
                });
            }
            p1unit(() => {
                if (def.stopOnFail !== undefined && !isBool(def.stopOnFail)) {            // rule 54
                    schemaFail(`${p}.stopOnFail`, 'boolean', def.stopOnFail);
                }
            });
            if (def.unique !== undefined) {
                p1unit(() => {
                    if (!isObj(def.unique)) schemaFail(`${p}.unique`, 'object', def.unique);
                    for (const k of ['enabled', 'nullsEqual']) {
                        if (def.unique[k] !== undefined && !isBool(def.unique[k])) {
                            schemaFail(`${p}.unique.${k}`, 'boolean', def.unique[k]);
                        }
                    }
                });
            }
            if (def.nullHandling !== undefined) {                                    // rule 25
                p1unit(() => {
                    if (!isObj(def.nullHandling)) schemaFail(`${p}.nullHandling`, 'object', def.nullHandling);
                    const ne = def.nullHandling.nullEquivalents;
                    if (ne !== undefined && ne !== null && !(Array.isArray(ne) && ne.every(isStr))) {
                        schemaFail(`${p}.nullHandling.nullEquivalents`, 'array of strings or null', ne);
                    }
                });
            }
            if (def.evaluation !== undefined) {                                       // rule 25
                p1unit(() => {
                    if (!isObj(def.evaluation)) schemaFail(`${p}.evaluation`, 'object', def.evaluation);
                    const sv = def.evaluation.strictType;
                    if (sv !== undefined && sv !== null && !isBool(sv)) {
                        schemaFail(`${p}.evaluation.strictType`, 'boolean or null', sv);
                    }
                });
            }

            const t = def.type;
            p1unit(() => {
                if (!isObj(t)) schemaFail(`${p}.type`, 'type object', t);
                if (!TYPE_NAMES.includes(t.name)) schemaFail(`${p}.type.name`, `one of ${TYPE_NAMES.join(', ')}`, t.name);  // rule 18
            });
            if (!isObj(t) || !TYPE_NAMES.includes(t.name)) continue;
            colTypes[name] = t.name;

            const ALLOWED_KEYS = {                                                    // rule 19
                string: ['length', 'regex', 'regexFlags'],
                int: ['formats', 'value'],
                float: ['formats', 'value', 'precision'],
                bool: ['trueValues', 'falseValues', 'matchStrategy'],
                datetime: ['formats', 'value'], date: ['formats', 'value'], time: ['formats', 'value'],
                categorical: ['allowedValues', 'typeStrict', 'matchStrategy'],
                skip: [],
            };
            for (const k of Object.keys(t)) {
                if (k === 'name') continue;
                p1unit(() => {
                    if (!ALLOWED_KEYS[t.name].includes(k)) {
                        schemaFail(`${p}.type.${k}`, `no "${k}" key on type "${t.name}"`, t[k]);
                    }
                });
            }

            if (t.name === 'string') {
                p1unit(() => {
                    if (t.length !== undefined && t.length !== null) checkRangeShape(t.length, `${p}.type.length`, 'count');
                });
                p1unit(() => {
                    if (t.regexFlags !== undefined && t.regexFlags !== null) {            // rule 24
                        if (t.regex == null) schemaFail(`${p}.type.regexFlags`, 'regexFlags only with non-null regex', t.regexFlags);
                        if (!isStr(t.regexFlags) || !/^[imsu]*$/.test(t.regexFlags) ||
                            new Set(t.regexFlags).size !== t.regexFlags.length) {
                            schemaFail(`${p}.type.regexFlags`, 'subset of "imsu", each at most once', t.regexFlags);
                        }
                    }
                });
                p1unit(() => {
                    if (t.regex !== undefined && t.regex !== null) {                      // rule 47
                        if (!isStr(t.regex)) schemaFail(`${p}.type.regex`, 'pattern string or null', t.regex);
                        const flagsOk = isStr(t.regexFlags) && /^[imsu]*$/.test(t.regexFlags) &&
                            new Set(t.regexFlags).size === t.regexFlags.length;
                        try { new RegExp(t.regex, flagsOk ? t.regexFlags : ''); }
                        catch (_) { schemaFail(`${p}.type.regex`, 'valid ECMAScript regex pattern', t.regex); }
                    }
                });
            } else if (t.name === 'int' || t.name === 'float') {
                p1unit(() => {
                    if (t.formats !== undefined && t.formats !== null) {
                        if (!Array.isArray(t.formats)) schemaFail(`${p}.type.formats`, 'array of NumberFormat objects or null', t.formats);
                        t.formats.forEach((f, i) => checkNumberFormatShape(f, `${p}.type.formats[${i}]`));
                    }
                });
                p1unit(() => {
                    if (t.value !== undefined && t.value !== null) {
                        checkRangeShape(t.value, `${p}.type.value`, t.name === 'int' ? 'intSafe' : 'number'); // rules 15, 52
                    }
                });
                p1unit(() => {
                    if (t.name === 'float' && t.precision !== undefined && t.precision !== null) {
                        checkRangeShape(t.precision, `${p}.type.precision`, 'count');       // rule 14
                    }
                });
            } else if (t.name === 'bool') {
                p1unit(() => {
                    for (const k of ['trueValues', 'falseValues']) {                        // rule 22
                        if (t[k] !== undefined && !(Array.isArray(t[k]) && t[k].length > 0 && t[k].every(isStr))) {
                            schemaFail(`${p}.type.${k}`, 'non-empty string array', t[k]);
                        }
                    }
                    if (t.matchStrategy !== undefined) checkStrategyShape(t.matchStrategy, `${p}.type.matchStrategy`);
                    const ms = effStrategy(t.matchStrategy, [false, true, false]);          // rule 43
                    const tv = (t.trueValues || ['true', '1', 'yes']).map((s) => applyStrategy(s, ms));
                    const fv = (t.falseValues || ['false', '0', 'no']).map((s) => applyStrategy(s, ms));
                    const overlap = tv.find((v) => fv.includes(v));
                    if (overlap !== undefined) {
                        schemaFail(`${p}.type.trueValues`, 'no overlap with falseValues after matchStrategy', overlap);
                    }
                });
            } else if (TEMPORAL[t.name]) {
                p1unit(() => {
                    if (!(Array.isArray(t.formats) && t.formats.length > 0 && t.formats.every(isStr))) {  // rule 20
                        schemaFail(`${p}.type.formats`, 'non-empty array of format strings', t.formats);
                    }
                });
                if (Array.isArray(t.formats) && t.formats.every(isStr)) {
                    for (let i = 0; i < t.formats.length; i++) {                            // rules 48, 21
                        p1unit(() => {
                            const toks = scanFormatTokens(t.formats[i]);
                            if (toks == null) {
                                schemaFail(`${p}.type.formats[${i}]`, 'valid temporal format (Core Spec §13.3 tokens)', t.formats[i]);
                            }
                            const has = (x) => toks.includes(x);
                            const hasYear = has('yyyy') || has('yy');
                            const hasMonth = has('MM') || has('M');            // M/d accepted since 1.1.0
                            const hasDay = has('dd') || has('d');
                            const timeToks = ['HH', 'hh', 'mm', 'ss', 'SSS', 'a', 'ZZ'];
                            const dateToks = ['yyyy', 'yy', 'MM', 'dd', 'M', 'd'];
                            if (t.name === 'datetime') {
                                if (!(hasYear && hasMonth && hasDay && (has('HH') || has('hh')) && has('mm'))) {
                                    schemaFail(`${p}.type.formats[${i}]`,
                                        'datetime format with year, month, day, hours, and mm', t.formats[i]);
                                }
                            } else if (t.name === 'date') {
                                if (!(hasYear && hasMonth && hasDay) || timeToks.some(has)) {
                                    schemaFail(`${p}.type.formats[${i}]`,
                                        'date format with year, month, day and no time tokens', t.formats[i]);
                                }
                            } else {
                                if (!((has('HH') || has('hh')) && has('mm')) || dateToks.some(has)) {
                                    schemaFail(`${p}.type.formats[${i}]`,
                                        'time format with hours and mm and no date tokens', t.formats[i]);
                                }
                            }
                        });
                    }
                }
                p1unit(() => {
                    if (t.value !== undefined && t.value !== null) {                        // rules 16, 17
                        checkRangeShape(t.value, `${p}.type.value`, t.name);
                    }
                });
            } else if (t.name === 'categorical') {
                p1unit(() => {
                    const av = t.allowedValues;                                             // rule 23
                    if (!(Array.isArray(av) && av.length > 0 &&
                        av.every((v) => v !== null && ['string', 'number', 'boolean'].includes(typeof v)))) {
                        schemaFail(`${p}.type.allowedValues`, 'non-empty array of non-null scalars', av);
                    }
                });
                p1unit(() => {
                    if (t.typeStrict !== undefined && !isBool(t.typeStrict)) {
                        schemaFail(`${p}.type.typeStrict`, 'boolean', t.typeStrict);
                    }
                });
                p1unit(() => {
                    if (t.matchStrategy !== undefined) checkStrategyShape(t.matchStrategy, `${p}.type.matchStrategy`);
                });
            }
        }

        // ---- cross-cutting rules 41, 42
        const matching = isObj(st) && st.columnMatching !== undefined ? st.columnMatching : 'byName';
        if (matching === 'byName') {                                                  // rule 41
            const fnm = effStrategy(isObj(st) ? st.fieldNameMatching : undefined, [false, true, false]);
            const seen = new Map();
            for (const name of colNames) {
                const n = applyStrategy(name, fnm);
                p1unit(() => {
                    if (seen.has(n)) {
                        schemaFail(`columns.${name}`,
                            'column names distinct after fieldNameMatching normalization',
                            `collides with "${seen.get(n)}"`);
                    }
                });
                if (!seen.has(n)) seen.set(n, name);
            }
        } else {                                                                      // rule 42
            const allowMissing = st.allowMissingColumns !== undefined ? st.allowMissingColumns : false;
            let sawOptional = null;
            for (const name of colNames) {
                if (!isObj(schema.columns[name])) continue;
                const d = schema.columns[name].required;
                const effReq = (d === undefined || d === null) ? !allowMissing : (isBool(d) ? d : true);
                if (!effReq) sawOptional = name;
                else {
                    const opt = sawOptional;
                    p1unit(() => {
                        if (opt != null) {
                            schemaFail(`columns.${name}.required`,
                                'optional columns to form a trailing suffix in byPosition mode',
                                `required column after optional "${opt}"`);
                        }
                    });
                }
            }
        }

        // ---- compositeKeys (rules 8, 27, 31, 46)
        const cks = schema.compositeKeys !== undefined ? schema.compositeKeys : [];
        p1unit(() => { if (!Array.isArray(cks)) schemaFail('compositeKeys', 'array', cks); });
        const ckSigs = new Set();
        if (Array.isArray(cks)) cks.forEach((ck, i) => p1unit(() => {
            const p = `compositeKeys[${i}]`;
            if (!isObj(ck)) schemaFail(p, 'composite key object', ck);
            if (!(Array.isArray(ck.columns) && ck.columns.length >= 2 && ck.columns.every(isStr))) {
                schemaFail(`${p}.columns`, 'string array with length >= 2', ck.columns);   // rule 31
            }
            for (const c of ck.columns) {
                if (!colNames.includes(c)) schemaFail(`${p}.columns`, 'existing column name', c);  // rule 27
            }
            if (ck.nullsAllowed !== undefined && !isBool(ck.nullsAllowed)) {
                schemaFail(`${p}.nullsAllowed`, 'boolean', ck.nullsAllowed);
            }
            if (ck.severity !== undefined && !SEVERITIES.includes(ck.severity)) {
                schemaFail(`${p}.severity`, '"error" or "warning"', ck.severity);
            }
            const sig = ck.columns.slice().sort().join('\u0001');                       // rule 46
            if (ckSigs.has(sig)) schemaFail(`${p}.columns`, 'no duplicate composite key definitions', ck.columns);
            ckSigs.add(sig);
        }));

        // ---- customRowChecks (rules 8, 28, 30, 32–35)
        const rcs = schema.customRowChecks !== undefined ? schema.customRowChecks : [];
        p1unit(() => { if (!Array.isArray(rcs)) schemaFail('customRowChecks', 'array', rcs); });
        if (Array.isArray(rcs)) rcs.forEach((chk, i) => p1unit(() => {
            const p = `customRowChecks[${i}]`;
            if (!isObj(chk)) schemaFail(p, 'check object', chk);
            if (!isStr(chk.name) || chk.name.length === 0) schemaFail(`${p}.name`, 'non-empty string', chk.name);
            if (!['comparison', 'conditionalRequired', 'nonNullCount', 'cooccurrence', 'custom'].includes(chk.type)) {
                schemaFail(`${p}.type`, 'valid row check type', chk.type);
            }
            if (chk.severity !== undefined && !SEVERITIES.includes(chk.severity)) {
                schemaFail(`${p}.severity`, '"error" or "warning"', chk.severity);
            }
            const mustExist = (f, fp) => {
                if (!isStr(f) || !colNames.includes(f)) schemaFail(fp, 'existing column name', f);  // rule 28
            };
            if (chk.type === 'comparison') {
                mustExist(chk.fieldA, `${p}.fieldA`);
                mustExist(chk.fieldB, `${p}.fieldB`);
                if (!COMP_OPS.includes(chk.op)) schemaFail(`${p}.op`, 'comparison operator', chk.op);
                // colTypes[x] is undefined only in accumulate mode when the column's own
                // type error was already recorded — skip the class check, not a new defect.
                if (colTypes[chk.fieldA] !== undefined && colTypes[chk.fieldB] !== undefined) {
                    const ca = COMPARISON_CLASS[colTypes[chk.fieldA]];                   // rule 34
                    const cb = COMPARISON_CLASS[colTypes[chk.fieldB]];
                    if (!ca || !cb || ca !== cb) {
                        schemaFail(`${p}.fieldA`, 'fields of the same comparison class ({int,float}, {string}, {datetime}, {date}, {time})',
                            `${colTypes[chk.fieldA]} vs ${colTypes[chk.fieldB]}`);
                    }
                }
            } else if (chk.type === 'conditionalRequired') {                             // rule 35
                if (!isObj(chk.if)) schemaFail(`${p}.if`, 'object', chk.if);
                mustExist(chk.if.field, `${p}.if.field`);
                if (!COMP_OPS.includes(chk.if.op)) schemaFail(`${p}.if.op`, 'comparison operator', chk.if.op);
                if (!isObj(chk.then)) schemaFail(`${p}.then`, 'object', chk.then);
                mustExist(chk.then.field, `${p}.then.field`);
                if (chk.then.nonNull !== true) schemaFail(`${p}.then.nonNull`, 'true', chk.then.nonNull);
                const ft = colTypes[chk.if.field];
                const v = chk.if.value;
                if (ft === 'skip') schemaFail(`${p}.if.field`, 'non-skip column', chk.if.field);
                else if (ft === 'int' || ft === 'float') { if (!isNum(v)) schemaFail(`${p}.if.value`, 'number', v); }
                else if (ft === 'string') { if (!isStr(v)) schemaFail(`${p}.if.value`, 'string', v); }
                else if (ft === 'bool') {
                    if (!isBool(v) || (chk.if.op !== '==' && chk.if.op !== '!=')) {
                        schemaFail(`${p}.if.value`, 'boolean literal with == or != operator', v);
                    }
                } else if (ft === 'categorical') {
                    if (v === null || !['string', 'number', 'boolean'].includes(typeof v) ||
                        (chk.if.op !== '==' && chk.if.op !== '!=')) {
                        schemaFail(`${p}.if.value`, 'scalar literal with == or != operator', v);
                    }
                } else if (ft === 'datetime') {
                    if (!isStr(v) || !getLuxon().DateTime.fromISO(v, { zone: 'utc' }).isValid) {
                        schemaFail(`${p}.if.value`, 'ISO datetime string', v);
                    }
                } else if (ft === 'date') {
                    if (!isStr(v) || parseIsoDateKey(v) == null) schemaFail(`${p}.if.value`, 'ISO date string', v);
                } else if (ft === 'time') {
                    if (!isStr(v) || parseTimeMsod(v) == null) schemaFail(`${p}.if.value`, 'time string', v);
                }
            } else if (chk.type === 'nonNullCount' || chk.type === 'cooccurrence') {     // rule 32
                if (!(Array.isArray(chk.fields) && chk.fields.length >= 2)) {
                    schemaFail(`${p}.fields`, 'field array with length >= 2', chk.fields);
                }
                chk.fields.forEach((f, j) => mustExist(f, `${p}.fields[${j}]`));
                if (chk.type === 'nonNullCount') {                                       // rule 33
                    if (!isIntN(chk.expected) || chk.expected < 0 || chk.expected > chk.fields.length) {
                        schemaFail(`${p}.expected`, `integer between 0 and ${chk.fields.length}`, chk.expected);
                    }
                }
            } else {                                                                     // custom, rule 30
                if (!isStr(chk.fn) || typeof functions[chk.fn] !== 'function') {
                    schemaFail(`${p}.fn`, 'name of a registered function', chk.fn);
                }
                if (chk.params !== undefined && chk.params !== null && !isObj(chk.params)) {
                    schemaFail(`${p}.params`, 'object or null', chk.params);
                }
            }
        }));

        // ---- customTableChecks (rules 8, 29, 30, 36–40)
        const tcs = schema.customTableChecks !== undefined ? schema.customTableChecks : [];
        p1unit(() => { if (!Array.isArray(tcs)) schemaFail('customTableChecks', 'array', tcs); });
        if (Array.isArray(tcs)) tcs.forEach((chk, i) => p1unit(() => {
            const p = `customTableChecks[${i}]`;
            if (!isObj(chk)) schemaFail(p, 'check object', chk);
            if (!isStr(chk.name) || chk.name.length === 0) schemaFail(`${p}.name`, 'non-empty string', chk.name);
            if (!['monotonic', 'sequenceNoGaps', 'sumEquals', 'custom'].includes(chk.type)) {
                schemaFail(`${p}.type`, 'valid table check type', chk.type);
            }
            if (chk.severity !== undefined && !SEVERITIES.includes(chk.severity)) {
                schemaFail(`${p}.severity`, '"error" or "warning"', chk.severity);
            }
            const mustExist = (f, fp) => {
                if (!isStr(f) || !colNames.includes(f)) schemaFail(fp, 'existing column name', f);  // rule 29
            };
            if (chk.type === 'monotonic') {                                              // rule 40
                mustExist(chk.field, `${p}.field`);
                if (!['increasing', 'decreasing', 'nonDecreasing', 'nonIncreasing'].includes(chk.direction)) {
                    schemaFail(`${p}.direction`, 'valid direction', chk.direction);
                }
                if (colTypes[chk.field] !== undefined &&
                    !['int', 'float', 'string', 'datetime', 'date', 'time'].includes(colTypes[chk.field])) {
                    schemaFail(`${p}.field`, 'column of type int, float, string, datetime, date, or time', colTypes[chk.field]);
                }
            } else if (chk.type === 'sequenceNoGaps') {                                  // rule 38
                mustExist(chk.field, `${p}.field`);
                if (colTypes[chk.field] !== undefined && colTypes[chk.field] !== 'int') {
                    schemaFail(`${p}.field`, 'int column', colTypes[chk.field]);
                }
                if (chk.start !== undefined && chk.start !== null && !(isIntN(chk.start) && Number.isSafeInteger(chk.start))) {
                    schemaFail(`${p}.start`, 'integer or null', chk.start);
                }
            } else if (chk.type === 'sumEquals') {                                       // rules 36, 37, 39
                if (!(Array.isArray(chk.fields) && chk.fields.length >= 1)) {
                    schemaFail(`${p}.fields`, 'field array with length >= 1', chk.fields);
                }
                chk.fields.forEach((f, j) => {
                    mustExist(f, `${p}.fields[${j}]`);
                    if (colTypes[f] !== undefined && colTypes[f] !== 'int' && colTypes[f] !== 'float') {
                        schemaFail(`${p}.fields[${j}]`, 'int or float column', colTypes[f]);
                    }
                });
                const hasEV = chk.expectedValue !== undefined && chk.expectedValue !== null;
                const hasEF = chk.expectedField !== undefined && chk.expectedField !== null;
                if (hasEV === hasEF) {
                    schemaFail(`${p}.expectedValue`, 'exactly one of expectedValue or expectedField non-null',
                        { expectedValue: chk.expectedValue, expectedField: chk.expectedField });
                }
                if (hasEV && !isNum(chk.expectedValue)) schemaFail(`${p}.expectedValue`, 'number', chk.expectedValue);
                if (hasEF) {
                    mustExist(chk.expectedField, `${p}.expectedField`);
                    if (colTypes[chk.expectedField] !== undefined &&
                        colTypes[chk.expectedField] !== 'int' && colTypes[chk.expectedField] !== 'float') {
                        schemaFail(`${p}.expectedField`, 'int or float column', colTypes[chk.expectedField]);
                    }
                    const r = chk.expectedFieldRow;
                    if (!(r === 'first' || r === 'last' || isNonNegInt(r))) {
                        schemaFail(`${p}.expectedFieldRow`, '"first", "last", or a 0-based row index', r);
                    }
                }
                if (chk.tolerance !== undefined && !(isNum(chk.tolerance) && chk.tolerance >= 0)) {
                    schemaFail(`${p}.tolerance`, 'number >= 0', chk.tolerance);
                }
            } else {                                                                     // custom
                if (!isStr(chk.fn) || typeof functions[chk.fn] !== 'function') {
                    schemaFail(`${p}.fn`, 'name of a registered function', chk.fn);      // rule 30
                }
                if (chk.params !== undefined && chk.params !== null && !isObj(chk.params)) {
                    schemaFail(`${p}.params`, 'object or null', chk.params);
                }
            }
        }));
    }

    // ================================================================
    // Phase 2 — schema resolution (defaults, overrides, infos)
    // ================================================================

    const DEF_RANGE = { min: 0, max: null, minInclusive: true, maxInclusive: true };

    function resolveSchema(schema, rec) {
        const st = isObj(schema.structure) ? schema.structure : {};
        const ev = isObj(schema.evaluation) ? schema.evaluation : {};
        const nh = isObj(schema.nullHandling) ? schema.nullHandling : {};
        const dcn = isObj(st.duplicateColumnNames) ? st.duplicateColumnNames : {};
        const dd = isObj(st.duplicateDetection) ? st.duplicateDetection : {};

        const tableStrict = ev.strictType !== undefined ? ev.strictType : true;
        const tableNullEq = nh.nullEquivalents !== undefined ? nh.nullEquivalents : [];

        const R = {
            tz: ev.timezone !== undefined ? ev.timezone : 'utc',
            tableStrict,
            structure: {
                columnMatching: st.columnMatching !== undefined ? st.columnMatching : 'byName',
                fieldNameMatching: effStrategy(st.fieldNameMatching, [false, true, false]),
                rowCount: st.rowCount !== undefined ? st.rowCount : DEF_RANGE,
                columnCount: st.columnCount !== undefined ? st.columnCount : DEF_RANGE,
                allowDuplicateRows: st.allowDuplicateRows !== undefined ? st.allowDuplicateRows : true,
                allowAllNullRows: st.allowAllNullRows !== undefined ? st.allowAllNullRows : true,
                allowDuplicateColumns: st.allowDuplicateColumns !== undefined ? st.allowDuplicateColumns : true,
                allowAllNullColumns: st.allowAllNullColumns !== undefined ? st.allowAllNullColumns : true,
                dcnStrategy: dcn.strategy !== undefined ? dcn.strategy : 'halt',
                dcnPattern: dcn.renamePattern !== undefined ? dcn.renamePattern : '{name}~{index}',
                allowExtraColumns: st.allowExtraColumns !== undefined ? st.allowExtraColumns : false,
                allowMissingColumns: st.allowMissingColumns !== undefined ? st.allowMissingColumns : false,
                enforceColumnOrder: st.enforceColumnOrder !== undefined ? st.enforceColumnOrder : false,
                dupStrategy: effStrategy(dd.matchStrategy, [true, false, false]),
                severities: (function () {                       // F2: structural severity map (resolved)
                    const src = isObj(st.severities) ? st.severities : {};
                    const out = {};
                    for (const rn of STRUCT_SEV_RULES) {
                        out[rn] = src[rn] !== undefined ? src[rn]
                            : (rn === 'duplicateColumnName' ? 'warning' : 'error');
                    }
                    return out;
                })(),
            },
            columns: [],
            columnsByName: new Map(),
            compositeKeys: [],
            rowChecks: [],
            tableChecks: [],
        };

        const byPosition = R.structure.columnMatching === 'byPosition';
        // schema advisories are `warning` (Core §2.1)
        const info = (setting, reason) => rec.record('schemaResolution', 'warning', 'irrelevantSetting',
            [{ row: null, field: '_schema', context: { setting, reason } }]);

        // byPosition: name-based machinery irrelevant (only when explicitly configured)
        if (byPosition) {
            if (st.fieldNameMatching !== undefined) {
                info('structure.fieldNameMatching', 'columnMatching is "byPosition"; headers are not matched by name');
            }
            if (st.duplicateColumnNames !== undefined) {
                info('structure.duplicateColumnNames', 'columnMatching is "byPosition"; header names are ignored');
            }
            if (st.enforceColumnOrder !== undefined) {
                info('structure.enforceColumnOrder', 'columnMatching is "byPosition"; column order is positional by construction');
            }
        }
        if (isObj(schema.comparison)) {
            if (byPosition && isObj(schema.comparison.fields)) {
                for (const [fname, fspec] of Object.entries(schema.comparison.fields)) {
                    if (isObj(fspec) && fspec.expectedName != null) {
                        info(`comparison.fields.${fname}.expectedName`,
                            'columnMatching is "byPosition"; expected-side columns are matched positionally, not by name');
                    }
                }
            }
            const cm = schema.comparison.match;
            if (isObj(schema.comparison.severity) && schema.comparison.severity.duplicateMatchKey !== undefined &&
                !(isObj(cm) && cm.onDuplicateKey === 'reportAndExclude')) {
                info('comparison.severity.duplicateMatchKey',
                    'onDuplicateKey is "abort" (the default); a duplicate key is an intrinsic abort, not a mappable tier');
            }
        }

        let idx = 0;
        for (const [name, def] of Object.entries(schema.columns)) {
            const t = def.type;
            const tn = t.name;
            const declaredRequired = (def.required === undefined) ? null : def.required;
            const colStrictRaw = isObj(def.evaluation) && def.evaluation.strictType !== undefined
                ? def.evaluation.strictType : null;
            const colNullEqRaw = isObj(def.nullHandling) && def.nullHandling.nullEquivalents !== undefined
                ? def.nullHandling.nullEquivalents : null;
            const strict = colStrictRaw !== null ? colStrictRaw : tableStrict;

            const col = {
                name, idx,
                required: declaredRequired !== null ? declaredRequired : !R.structure.allowMissingColumns,
                nullable: def.nullable !== undefined ? def.nullable : false,
                severity: def.severity !== undefined ? def.severity : 'error',
                stopOnFail: def.stopOnFail === true,
                unique: {
                    enabled: isObj(def.unique) && def.unique.enabled !== undefined ? def.unique.enabled : false,
                    nullsEqual: isObj(def.unique) && def.unique.nullsEqual !== undefined ? def.unique.nullsEqual : false,
                },
                nullEq: new Set(colNullEqRaw !== null ? colNullEqRaw : tableNullEq),
                strict,
                tn,
                type: null,
                indices: [],        // matched table column indices (Phase 4)
                primary: -1,
                memo: null,          // interpreted values per row (primary instance)
                checkedRows: 0,      // rows actually checked in Phase 6 (maxErrorsPerColumn)
                bounds: null,        // resolved temporal bounds (Phase 3)
            };

            if (tn === 'string') {
                col.type = {
                    length: t.length != null ? t.length : null,
                    regex: t.regex != null ? t.regex : null,
                    regexFlags: t.regexFlags != null ? t.regexFlags : null,
                    compiled: t.regex != null ? new RegExp(t.regex, t.regexFlags || '') : null,
                };
            } else if (tn === 'int' || tn === 'float') {
                col.type = {
                    formats: t.formats != null ? t.formats.map((f) => ({
                        decimalSeparator: f.decimalSeparator !== undefined ? f.decimalSeparator : null,
                        groupingSeparators: f.groupingSeparators !== undefined ? f.groupingSeparators : [],
                        allowBareDecimal: f.allowBareDecimal === true,                 // §3.5 (1.2.0)
                    })) : null,
                    value: t.value != null ? t.value : null,
                    precision: tn === 'float' && t.precision != null ? t.precision : null,
                };
            } else if (tn === 'bool') {
                col.type = {
                    trueValues: t.trueValues !== undefined ? t.trueValues : ['true', '1', 'yes'],
                    falseValues: t.falseValues !== undefined ? t.falseValues : ['false', '0', 'no'],
                    matchStrategy: effStrategy(t.matchStrategy, [false, true, false]),
                };
            } else if (TEMPORAL[tn]) {
                col.type = { formats: t.formats.slice(), value: t.value != null ? t.value : null };
            } else if (tn === 'categorical') {
                col.type = {
                    allowedValues: t.allowedValues.slice(),
                    typeStrict: t.typeStrict !== undefined ? t.typeStrict : false,
                    matchStrategy: effStrategy(t.matchStrategy, [false, true, false]),
                };
            } else {
                col.type = {};
            }

            // irrelevant-setting infos (only for explicitly configured settings)
            if (isObj(def.unique) && def.unique.nullsEqual !== undefined && !col.nullable) {
                info(`columns.${name}.unique.nullsEqual`, 'nullable is false, so no effectively-null cells participate');
            }
            if (colStrictRaw !== null && (TEMPORAL[tn] || tn === 'categorical' || tn === 'skip')) {
                info(`columns.${name}.evaluation.strictType`, `strictType is irrelevant for ${tn} columns`);
            }
            if (strict && (tn === 'int' || tn === 'float') && t.formats != null) {
                info(`columns.${name}.type.formats`, 'effective strictType is true, so string formats are unused');
            }
            if (strict && tn === 'bool' &&
                (t.trueValues !== undefined || t.falseValues !== undefined || t.matchStrategy !== undefined)) {
                info(`columns.${name}.type`, 'effective strictType is true, so boolean value lists are unused');
            }

            R.columns.push(col);
            R.columnsByName.set(name, col);
            idx++;
        }

        for (const ck of (Array.isArray(schema.compositeKeys) ? schema.compositeKeys : [])) {
            R.compositeKeys.push({
                columns: ck.columns.slice(),
                nullsAllowed: ck.nullsAllowed !== undefined ? ck.nullsAllowed : false,
                severity: ck.severity !== undefined ? ck.severity : 'error',
            });
        }
        for (const chk of (Array.isArray(schema.customRowChecks) ? schema.customRowChecks : [])) {
            R.rowChecks.push(Object.assign({}, jsonClone(chk), {
                severity: chk.severity !== undefined ? chk.severity : 'error',
                params: chk.params !== undefined ? chk.params : null,
            }));
        }
        for (const chk of (Array.isArray(schema.customTableChecks) ? schema.customTableChecks : [])) {
            R.tableChecks.push(Object.assign({}, jsonClone(chk), {
                severity: chk.severity !== undefined ? chk.severity : 'error',
                params: chk.params !== undefined ? chk.params : null,
                tolerance: chk.type === 'sumEquals' && chk.tolerance !== undefined ? chk.tolerance : 0,
                start: chk.type === 'sequenceNoGaps' && chk.start !== undefined ? chk.start : null,
            }));
        }
        return R;
    }

    // ================================================================
    // Phase 3 — runtime resolution (reference instant, T+/-N, temporal bounds)
    // ================================================================

    function makeReferenceInstant(refRaw) {
        const l = getLuxon();
        let dt;
        if (refRaw == null) dt = l.DateTime.now();
        else if (refRaw instanceof Date) dt = l.DateTime.fromJSDate(refRaw);
        else dt = l.DateTime.fromISO(refRaw);
        if (!dt || !dt.isValid) {
            throw new TableValidationConfigError(
                `Unusable referenceInstant: ${String(refRaw)} (expected an ISO 8601 string or Date)`);
        }
        return dt;
    }

    function pad(n, w) { return String(n).padStart(w, '0'); }
    const keyToIso = (k) => `${pad(Math.floor(k / 10000), 4)}-${pad(Math.floor(k / 100) % 100, 2)}-${pad(k % 100, 2)}`;

    function runtimeResolve(R, refRaw) {
        const hasTemporal = R.columns.some((c) => TEMPORAL[c.tn]);
        if (!hasTemporal) return;
        const l = getLuxon();
        const zone = zoneName(R.tz);
        const ref = makeReferenceInstant(refRaw);
        R.zone = zone;
        R.ref = ref;

        const resolveBound = (v, tn, isMin) => {
            if (v == null) return { cmp: null, disp: null };
            const m = TPN_RE.exec(v);
            if (m) {
                const n = m[1] ? parseInt(m[1], 10) : 0;
                const base = ref.setZone(zone).plus({ days: n });      // calendar-day arithmetic (DST-safe)
                if (tn === 'date') {
                    const k = dateKey(base.year, base.month, base.day); // min→start / max→end of day collapse to the same calendar date
                    return { cmp: k, disp: keyToIso(k) };
                }
                return { cmp: base.toMillis(), disp: base.toISO() };
            }
            if (tn === 'date') {
                const k = parseIsoDateKey(v);
                return { cmp: k, disp: v };
            }
            if (tn === 'time') return { cmp: parseTimeMsod(v), disp: v };
            const dt = l.DateTime.fromISO(v, { zone });
            return { cmp: dt.toMillis(), disp: v };
        };

        for (const col of R.columns) {
            if (!TEMPORAL[col.tn] || col.type.value == null) continue;
            const rv = col.type.value;
            const mn = resolveBound(rv.min, col.tn, true);
            const mx = resolveBound(rv.max, col.tn, false);
            col.bounds = {
                min: mn.cmp, max: mx.cmp,
                minDisp: mn.disp, maxDisp: mx.disp,
                minInclusive: rv.minInclusive, maxInclusive: rv.maxInclusive,
            };
        }

        // pre-resolve temporal literals of conditionalRequired checks
        for (const chk of R.rowChecks) {
            if (chk.type !== 'conditionalRequired') continue;
            const col = R.columnsByName.get(chk.if.field);
            if (!col || !TEMPORAL[col.tn]) continue;
            if (col.tn === 'date') chk.ifCmp = parseIsoDateKey(chk.if.value);
            else if (col.tn === 'time') chk.ifCmp = parseTimeMsod(chk.if.value);
            else chk.ifCmp = l.DateTime.fromISO(chk.if.value, { zone }).toMillis();
        }
    }

    // ================================================================
    // Interpretation (Core §8.6) — read-only, memoized
    // ================================================================

    // interp kinds: {k:0} effectively null · {k:1, at, cat?} uninterpretable · {k:2, v, cmp?, prec?, dt?}
    const I_NULL = { k: 0 };

    function actualTypeOf(cell) {
        if (cell === null || cell === undefined) return 'null';
        if (Array.isArray(cell)) return 'array';
        const t = typeof cell;
        if (t === 'object') return 'object';
        if (t === 'boolean') return 'bool';
        if (t === 'number') return Number.isInteger(cell) && Number.isSafeInteger(cell) ? 'int' : 'float';
        return 'string';
    }

    function effNull(col, cell) {
        return cell === null || cell === undefined ||
            (typeof cell === 'string' && col.nullEq.has(cell));
    }

    function floatPrecisionOfCanonical(v) {
        const s = String(v);
        const m = /\.(\d+)/.exec(s);
        return m ? m[1].length : 0;
    }

    function interpretCell(R, col, cell) {
        if (effNull(col, cell)) return I_NULL;
        const tn = col.tn;
        if (tn === 'skip') return { k: 2, v: cell };
        const at = actualTypeOf(cell);
        if (at === 'object' || at === 'array') return { k: 1, at };

        if (tn === 'string') {
            if (typeof cell === 'string') return { k: 2, v: cell };
            return col.strict ? { k: 1, at } : { k: 2, v: canonical(cell) };
        }
        if (tn === 'int') {
            if (typeof cell === 'number') {
                return (Number.isInteger(cell) && Number.isSafeInteger(cell))
                    ? { k: 2, v: cell } : { k: 1, at: 'float' };
            }
            if (typeof cell === 'string' && !col.strict) {
                for (const f of (col.type.formats || [])) {
                    const r = interpretNumberFormat(cell, f, true);
                    if (r && Number.isSafeInteger(r.value)) return { k: 2, v: r.value };
                }
                if (INT_RE.test(cell)) {
                    const v = Number(cell);
                    if (Number.isSafeInteger(v)) return { k: 2, v };
                }
            }
            return { k: 1, at };
        }
        if (tn === 'float') {
            if (typeof cell === 'number') return { k: 2, v: cell, prec: floatPrecisionOfCanonical(cell) };
            if (typeof cell === 'string' && !col.strict) {
                for (const f of (col.type.formats || [])) {
                    const r = interpretNumberFormat(cell, f, false);
                    if (r) return { k: 2, v: r.value, prec: r.precision };
                }
                if (FLOAT_RE.test(cell)) {
                    const dot = cell.indexOf('.');
                    return { k: 2, v: Number(cell), prec: dot === -1 ? 0 : cell.length - dot - 1 };
                }
            }
            return { k: 1, at };
        }
        if (tn === 'bool') {
            if (typeof cell === 'boolean') return { k: 2, v: cell };
            if (typeof cell === 'string' && !col.strict) {
                const ms = col.type.matchStrategy;
                const c = applyStrategy(cell, ms);
                if (col.type.trueValues.some((s) => applyStrategy(s, ms) === c)) return { k: 2, v: true };
                if (col.type.falseValues.some((s) => applyStrategy(s, ms) === c)) return { k: 2, v: false };
            }
            return { k: 1, at };
        }
        if (TEMPORAL[tn]) {
            if (typeof cell !== 'string') return { k: 1, at };
            const l = getLuxon();
            const zone = R.zone || zoneName(R.tz);
            for (const fmt of col.type.formats) {
                const dt = l.DateTime.fromFormat(cell, fmt, { zone });
                if (dt.isValid) {
                    if (tn === 'datetime') return { k: 2, v: cell, cmp: dt.toMillis(), dt };
                    if (tn === 'date') return { k: 2, v: cell, cmp: dateKey(dt.year, dt.month, dt.day), dt };
                    return {
                        k: 2, v: cell, dt,
                        cmp: dt.hour * 3600000 + dt.minute * 60000 + dt.second * 1000 + dt.millisecond,
                    };
                }
            }
            return { k: 1, at: 'string' };
        }
        // categorical
        const ct = col.type;
        if (ct.typeStrict) {
            for (const av of ct.allowedValues) {
                if (typeof cell !== typeof av) continue;
                if (typeof cell === 'string') {
                    if (applyStrategy(cell, ct.matchStrategy) === applyStrategy(av, ct.matchStrategy)) {
                        return { k: 2, v: cell };
                    }
                } else if (cell === av) return { k: 2, v: cell };
            }
        } else {
            const c = applyStrategy(canonical(cell), ct.matchStrategy);
            for (const av of ct.allowedValues) {
                if (applyStrategy(canonical(av), ct.matchStrategy) === c) return { k: 2, v: canonical(cell) };
            }
        }
        return { k: 1, at, cat: true };
    }

    function cellAt(rows, r, idx) {
        const row = rows[r];
        return idx < row.length ? (row[idx] === undefined ? null : row[idx]) : null;
    }

    // memoized interpretation of the PRIMARY instance of a column
    function interpAt(ctx, col, r) {
        if (col.primary < 0) return I_NULL;                    // unmatched column → effectively null view
        if (!col.memo) col.memo = new Array(ctx.rows.length);
        let i = col.memo[r];
        if (i === undefined) {
            i = interpretCell(ctx.R, col, cellAt(ctx.rows, r, col.primary));
            col.memo[r] = i;
        }
        return i;
    }

    // equality key for uniqueness / duplicate detection (Core §8.4j/8.5c/8.7)
    function eqKey(ctx, col, r) {
        const cell = col.primary < 0 ? null : cellAt(ctx.rows, r, col.primary);
        return eqKeyOfCell(ctx, col, cell, interpAt(ctx, col, r));
    }

    function eqKeyOfCell(ctx, col, cell, interp) {
        const ds = ctx.R.structure.dupStrategy;
        if (interp.k === 0) return '\u0000null';
        if (interp.k === 1) {
            return typeof cell === 'string'
                ? 'u:s:' + applyStrategy(cell, ds)
                : 'u:' + actualTypeOf(cell) + ':' + canonical(cell);
        }
        const v = interp.v;
        if (TEMPORAL[col.tn]) return 't:' + col.tn + ':' + interp.cmp;
        if (typeof v === 'number') return 'n:' + String(v);
        if (typeof v === 'boolean') return 'b:' + String(v);
        if (typeof v === 'string') return 's:' + applyStrategy(v, ds);
        return 'x:' + canonical(v);
    }

    // ================================================================
    // Phase 4 — structural checks, column axis
    // ================================================================

    // pure mapping derivation shared with the exporter
    function deriveMapping(R, headers, rows, onDupGroup) {
        const st = R.structure;
        const mode = st.columnMatching;
        const out = { mode, tableColCount: 0, extras: [], displayNames: [], dropped: new Set() };

        if (mode === 'byPosition') {
            let width = 0;
            for (const r of rows) width = Math.max(width, r.length);
            out.tableColCount = width;
            for (const col of R.columns) {
                col.indices = col.idx < width ? [col.idx] : [];
                col.primary = col.idx < width ? col.idx : -1;
            }
            for (let i = R.columns.length; i < width; i++) out.extras.push(i);
            for (let i = 0; i < width; i++) {
                out.displayNames.push(i < R.columns.length ? R.columns[i].name : `col_${i}`);
            }
            return out;
        }

        // byName
        out.tableColCount = headers.length;
        out.displayNames = headers.slice();

        // 4b — duplicate header names (raw equality)
        const byRaw = new Map();
        headers.forEach((h, i) => {
            if (!byRaw.has(h)) byRaw.set(h, []);
            byRaw.get(h).push(i);
        });
        for (const [name, idxs] of byRaw) {
            if (idxs.length < 2) continue;
            if (st.dcnStrategy === 'rename') {
                idxs.forEach((ti, k) => {
                    out.displayNames[ti] = st.dcnPattern.split('{name}').join(name).split('{index}').join(String(k));
                });
                if (onDupGroup) onDupGroup(name, idxs, out.displayNames, []);
            } else if (st.dcnStrategy === 'keepFirst') {
                const droppedIdx = idxs.slice(1);
                droppedIdx.forEach((ti) => out.dropped.add(ti));
                if (onDupGroup) onDupGroup(name, idxs, [name], droppedIdx);
            } else if (onDupGroup) {
                onDupGroup(name, idxs, null, null);        // halt strategy — handler records the halt
            }
        }

        // 4c/4e — normalized matching. A schema column matches ALL non-dropped table
        // columns whose normalized header equals its normalized name (covers "rename").
        const norm = (s) => applyStrategy(s, st.fieldNameMatching);
        const normHeaders = headers.map(norm);
        const claimed = new Set();
        for (const col of R.columns) {
            const n = norm(col.name);
            col.indices = [];
            for (let i = 0; i < headers.length; i++) {
                if (out.dropped.has(i)) continue;
                if (normHeaders[i] === n) {
                    col.indices.push(i);
                    claimed.add(i);
                }
            }
            col.primary = col.indices.length ? col.indices[0] : -1;
        }
        for (let i = 0; i < headers.length; i++) {
            if (!claimed.has(i)) out.extras.push(i);
        }
        return out;
    }

    function phase4(ctx) {
        const { R, headers, rows, rec } = ctx;
        const st = R.structure;
        const P = 'structuralColumnChecks';

        // 4a — header availability
        if (st.columnMatching === 'byName' && headers == null) {
            rec.record(P, 'error', 'headersMissing',
                [{ row: null, field: null, context: { columnMatching: 'byName' } }], 'headersMissing');
        }

        const M = deriveMapping(R, headers, rows, (name, idxs, resolvedNames, droppedIdx) => {
            if (st.dcnStrategy === 'halt') {
                rec.record(P, 'error', 'duplicateColumnName', [{
                    row: null, field: name,
                    context: { strategy: 'halt', occurrences: idxs.length, resolvedNames: null, droppedIndices: null },
                }], 'duplicateColumnName');
            } else {
                // F5: severity independent of strategy (structure.severities, default warning)
                rec.record(P, st.severities.duplicateColumnName, 'duplicateColumnName', [{
                    row: null, field: name,
                    context: {
                        strategy: st.dcnStrategy, occurrences: idxs.length,
                        resolvedNames: st.dcnStrategy === 'rename'
                            ? idxs.map((ti) => resolvedNames[ti]) : resolvedNames.slice(),
                        droppedIndices: droppedIdx.slice(),
                    },
                }]);
            }
        });
        ctx.mapping = M;
        ctx.columnsChecked = R.columns.filter((c) => c.primary >= 0).length;

        // 4d — column count
        const cc = st.columnCount;
        if (!inRange(M.tableColCount, cc.min, cc.max, cc.minInclusive, cc.maxInclusive)) {
            rec.record(P, st.severities.columnCountBreach, 'columnCountBreach', [{
                row: null, field: null,
                context: {
                    actual: M.tableColCount, min: cc.min, max: cc.max,
                    minInclusive: cc.minInclusive, maxInclusive: cc.maxInclusive,
                },
            }]);
        }

        // 4f — required columns present
        for (const col of R.columns) {
            if (col.required && col.primary < 0) {
                rec.record(P, resolveSev(col.severity, 'requiredColumnMissing'), 'requiredColumnMissing', [{
                    row: null, field: col.name,
                    context: { expectedPosition: M.mode === 'byPosition' ? col.idx : null },
                }], col.stopOnFail ? 'stopOnFail:' + col.name : undefined);
            }
        }

        // 4g — extra columns
        if (!st.allowExtraColumns) {
            for (const i of M.extras) {
                if (M.mode === 'byName') {
                    rec.record(P, st.severities.extraColumn, 'extraColumn', [{
                        row: null, field: headers[i], context: { position: i, headerName: headers[i] },
                    }]);
                } else {
                    rec.record(P, st.severities.extraColumn, 'extraColumn', [{
                        row: null, field: null, context: { position: i, headerName: null },
                    }]);
                }
            }
        }

        // 4h — column order (byName only)
        if (M.mode === 'byName' && st.enforceColumnOrder) {
            const matched = R.columns.filter((c) => c.primary >= 0);
            let lastPos = -1;
            matched.forEach((col, rank) => {
                if (col.primary !== rank) {
                    rec.record(P, st.severities.columnOrderViolation, 'columnOrderViolation', [{
                        row: null, field: col.name,
                        context: { expectedPosition: rank, actualPosition: col.primary },
                    }]);
                }
                lastPos = Math.max(lastPos, col.primary);
            });
            if (st.allowExtraColumns) {
                for (const i of M.extras) {
                    if (i < lastPos) {
                        rec.record(P, st.severities.columnOrderViolation, 'columnOrderViolation', [{
                            row: null, field: headers[i],
                            context: { expectedPosition: matched.length, actualPosition: i },
                        }]);
                    }
                }
            }
        }

        // 4i — all-null columns
        if (!st.allowAllNullColumns && rows.length > 0) {
            for (const col of R.columns) {
                if (col.primary < 0) continue;
                let allNull = true;
                for (let r = 0; r < rows.length; r++) {
                    if (!effNull(col, cellAt(rows, r, col.primary))) { allNull = false; break; }
                }
                if (allNull) {
                    rec.record(P, resolveSev(col.severity, 'allNullColumn'), 'allNullColumn',
                        [{ row: null, field: col.name, context: {} }],
                        col.stopOnFail ? 'stopOnFail:' + col.name : undefined);
                }
            }
        }

        // 4j — duplicate column content
        if (!st.allowDuplicateColumns && rows.length > 0) {
            const matched = R.columns.filter((c) => c.primary >= 0)
                .slice().sort((a, b) => a.primary - b.primary);
            const seen = new Map();
            for (const col of matched) {
                const sig = rows.map((_, r) => eqKey(ctx, col, r)).join('\u0001');
                if (seen.has(sig)) {
                    rec.record(P, resolveSev(col.severity, 'duplicateColumnContent'), 'duplicateColumnContent', [{
                        row: null, field: col.name, context: { duplicateOfColumn: seen.get(sig) },
                    }], col.stopOnFail ? 'stopOnFail:' + col.name : undefined);
                } else {
                    seen.set(sig, col.name);
                }
            }
        }
    }

    // ================================================================
    // Phase 5 — structural checks, row axis
    // ================================================================

    function phase5(ctx) {
        const { R, rows, rec } = ctx;
        const st = R.structure;
        const P = 'structuralRowChecks';

        const rcr = st.rowCount;
        if (!inRange(rows.length, rcr.min, rcr.max, rcr.minInclusive, rcr.maxInclusive)) {
            rec.record(P, st.severities.rowCountBreach, 'rowCountBreach', [{
                row: null, field: null,
                context: {
                    actual: rows.length, min: rcr.min, max: rcr.max,
                    minInclusive: rcr.minInclusive, maxInclusive: rcr.maxInclusive,
                },
            }]);
        }

        const matched = R.columns.filter((c) => c.primary >= 0);
        if (!st.allowAllNullRows && matched.length > 0) {
            for (let r = 0; r < rows.length; r++) {
                let allNull = true;
                for (const col of matched) {
                    if (!effNull(col, cellAt(rows, r, col.primary))) { allNull = false; break; }
                }
                if (allNull) rec.record(P, st.severities.allNullRow, 'allNullRow', [{ row: r, field: null, context: {} }]);
            }
        }

        if (!st.allowDuplicateRows && matched.length > 0) {
            const seen = new Map();
            for (let r = 0; r < rows.length; r++) {
                const sig = matched.map((col) => eqKey(ctx, col, r)).join('\u0001');
                if (seen.has(sig)) {
                    rec.record(P, st.severities.duplicateRow, 'duplicateRow',
                        [{ row: r, field: null, context: { duplicateOfRow: seen.get(sig) } }]);
                } else {
                    seen.set(sig, r);
                }
            }
        }
    }

    // ================================================================
    // Phase 6 — cell-level validation
    // ================================================================

    // F6: native vs interpreted label for a non-null, interpretable cell
    function interpKind(col, cell) {
        const tn = col.tn;
        if (tn === 'skip') return 'skipped';
        if (tn === 'string') return typeof cell === 'string' ? 'native' : 'interpreted';
        if (tn === 'int' || tn === 'float') return typeof cell === 'number' ? 'native' : 'interpreted';
        if (tn === 'bool') return typeof cell === 'boolean' ? 'native' : 'interpreted';
        if (TEMPORAL[tn]) return 'interpreted';                 // temporal values are string-carried
        if (tn === 'categorical') return col.type.typeStrict ? 'native' : 'interpreted';
        return 'native';
    }

    function phase6(ctx) {
        const { R, rows, rec, cfg, obs } = ctx;
        const P = 'cellValidation';

        // seed observations for unmatched columns as notChecked
        if (obs) {
            for (const col of R.columns) {
                if (col.primary >= 0) continue;
                for (let r = 0; r < rows.length; r++) {
                    obs.push({ row: r, field: col.name, rawValue: null, interpretedValue: null,
                        outcome: 'notChecked', worstSeverity: null });
                }
            }
        }

        for (const col of R.columns) {
            if (col.primary < 0) continue;
            let colErrs = 0;
            let truncatedCol = false;
            col.checkedRows = rows.length;
            const stopAbr = col.stopOnFail ? 'stopOnFail:' + col.name : undefined;

            for (const inst of col.indices) {
                const isPrimary = inst === col.primary;
                for (let r = 0; r < rows.length; r++) {
                    const cell = cellAt(rows, r, inst);
                    let worst = null;                          // worst severity for the observation
                    // emit: resolve severity per rule, count, track observation severity, then record
                    const emit = (ruleName, context) => {
                        const sev = resolveSev(col.severity, ruleName);
                        if (sev === 'error') colErrs++;
                        if (SEV_RANK[sev] < (worst == null ? Infinity : SEV_RANK[worst])) worst = sev;
                        rec.record(P, sev, ruleName, [{ row: r, field: col.name, value: cell, context }], stopAbr);
                    };
                    let outcome = null, interpVal = null;

                    if (effNull(col, cell)) {
                        if (isPrimary) {
                            if (!col.memo) col.memo = new Array(rows.length);
                            col.memo[r] = I_NULL;
                        }
                        outcome = 'effectivelyNull';
                        if (!col.nullable) { outcome = 'violation'; emit('nullabilityViolation', {}); }
                    } else {
                        const interp = interpretCell(R, col, cell);
                        if (isPrimary) {
                            if (!col.memo) col.memo = new Array(rows.length);
                            col.memo[r] = interp;
                        }
                        if (interp.k === 1) {
                            outcome = 'violation';
                            if (interp.cat) {
                                emit('categoryMismatch', {
                                    allowedValues: col.type.allowedValues.slice(),
                                    typeStrict: col.type.typeStrict,
                                });
                            } else {
                                emit('typeMismatch', { expectedType: col.tn, actualType: interp.at });
                            }
                        } else {
                            interpVal = interp.v;
                            outcome = interpKind(col, cell);
                            const t = col.type;
                            const breach = (constraint, rg) => emit('rangeBreach', {
                                constraint, min: rg.min, max: rg.max,
                                minInclusive: rg.minInclusive, maxInclusive: rg.maxInclusive,
                            });
                            if (col.tn === 'string') {
                                if (t.length &&
                                    !inRange(cpLength(interp.v), t.length.min, t.length.max,
                                        t.length.minInclusive, t.length.maxInclusive)) breach('length', t.length);
                                if (t.compiled && !t.compiled.test(interp.v)) {
                                    emit('regexMismatch', { regex: t.regex, regexFlags: t.regexFlags });
                                }
                            } else if (col.tn === 'int' || col.tn === 'float') {
                                if (t.value &&
                                    !inRange(interp.v, t.value.min, t.value.max,
                                        t.value.minInclusive, t.value.maxInclusive)) breach('value', t.value);
                                if (col.tn === 'float' && t.precision &&
                                    !inRange(interp.prec, t.precision.min, t.precision.max,
                                        t.precision.minInclusive, t.precision.maxInclusive)) breach('precision', t.precision);
                            } else if (TEMPORAL[col.tn] && col.bounds) {
                                const b = col.bounds;
                                if (!inRange(interp.cmp, b.min, b.max, b.minInclusive, b.maxInclusive)) {
                                    emit('rangeBreach', {
                                        constraint: 'value', min: b.minDisp, max: b.maxDisp,
                                        minInclusive: b.minInclusive, maxInclusive: b.maxInclusive,
                                    });
                                }
                            }
                            if (worst != null) outcome = 'violation';
                        }
                    }

                    if (isPrimary && obs) {
                        obs.push({
                            row: r, field: col.name, rawValue: cell,
                            interpretedValue: interpVal,
                            outcome, worstSeverity: worst,
                        });
                    }

                    // per-column circuit breaker (Phase 6 only)
                    if (cfg.maxErrorsPerColumn != null && colErrs >= cfg.maxErrorsPerColumn) {
                        rec.markColumnTruncated(col.name);
                        if (isPrimary) {
                            col.checkedRows = r + 1;
                            if (obs) {                          // remaining rows unchecked for this column
                                for (let rr = r + 1; rr < rows.length; rr++) {
                                    obs.push({ row: rr, field: col.name, rawValue: cellAt(rows, rr, inst),
                                        interpretedValue: null, outcome: 'notChecked', worstSeverity: null });
                                }
                            }
                        }
                        truncatedCol = true;
                        break;
                    }
                }
                if (truncatedCol) break;
            }
        }
    }

    // ================================================================
    // Phase 7 — column aggregate checks
    // ================================================================

    function phase7(ctx) {
        const { R, rows, rec } = ctx;
        const P = 'columnAggregateChecks';

        // 7a — per-column uniqueness
        for (const col of R.columns) {
            if (col.primary < 0 || !col.unique.enabled) continue;
            const occ = new Map();           // key → row[]
            const order = [];
            const limit = Math.min(col.checkedRows || rows.length, rows.length);
            for (let r = 0; r < limit; r++) {
                const i = interpAt(ctx, col, r);
                let key;
                if (i.k === 0) {
                    if (!col.unique.nullsEqual) continue;      // excluded
                    key = '\u0000null';
                } else {
                    key = eqKeyOfCell(ctx, col, cellAt(rows, r, col.primary), i);
                }
                if (!occ.has(key)) { occ.set(key, []); order.push(key); }
                occ.get(key).push(r);
            }
            for (const key of order) {
                const rs = occ.get(key);
                if (rs.length < 2) continue;
                const first = rs[0];
                for (const r of rs) {
                    rec.record(P, resolveSev(col.severity, 'uniquenessViolation'), 'uniquenessViolation', [{
                        row: r, field: col.name, value: cellAt(rows, r, col.primary),
                        context: {
                            nullsEqual: col.unique.nullsEqual,
                            duplicateOfRow: r === first ? null : first,
                        },
                    }], col.stopOnFail ? 'stopOnFail:' + col.name : undefined);
                }
            }
        }

        // 7b — composite keys
        for (const ck of R.compositeKeys) {
            const cols = ck.columns.map((n) => R.columnsByName.get(n));
            if (cols.some((c) => !c || c.primary < 0)) continue;   // key column absent from the table
            const occ = new Map();
            const order = [];
            for (let r = 0; r < rows.length; r++) {
                const nullCols = cols.filter((c) => interpAt(ctx, c, r).k === 0);
                if (nullCols.length > 0) {
                    if (!ck.nullsAllowed) {
                        rec.record(P, ck.severity, 'compositeKeyNullViolation', nullCols.map((c) => ({
                            row: r, field: c.name, value: cellAt(rows, r, c.primary),
                            context: { keyColumns: ck.columns.slice(), nullColumn: c.name },
                        })));
                    }
                    continue;                                       // excluded from tuple comparison
                }
                const key = cols.map((c) => eqKey(ctx, c, r)).join('\u0002');
                if (!occ.has(key)) { occ.set(key, []); order.push(key); }
                occ.get(key).push(r);
            }
            for (const key of order) {
                const rs = occ.get(key);
                if (rs.length < 2) continue;
                const first = rs[0];
                for (const r of rs) {
                    rec.record(P, ck.severity, 'compositeKeyViolation', cols.map((c) => ({
                        row: r, field: c.name, value: cellAt(rows, r, c.primary),
                        context: {
                            keyColumns: ck.columns.slice(), nullsAllowed: ck.nullsAllowed,
                            duplicateOfRow: r === first ? null : first,
                        },
                    })));
                }
            }
        }
    }

    // ================================================================
    // Phase 8 — row-level cross-column checks
    // ================================================================

    function compareInterp(col, a, b) {
        if (TEMPORAL[col.tn]) return a.cmp - b.cmp;
        if (typeof a.v === 'number') return a.v - b.v;
        if (typeof a.v === 'string') return cpCompare(a.v, b.v);
        return a.v === b.v ? 0 : (a.v ? 1 : -1);
    }

    function opHolds(op, cmp) {
        switch (op) {
            case '<': return cmp < 0;
            case '<=': return cmp <= 0;
            case '==': return cmp === 0;
            case '!=': return cmp !== 0;
            case '>=': return cmp >= 0;
            case '>': return cmp > 0;
        }
        return false;
    }

    function exposeInterp(col, i) {
        if (i.k !== 2) return null;
        return TEMPORAL[col.tn] ? i.dt : i.v;
    }

    function buildRowMaps(ctx, r) {
        const row = {};
        const interp = {};
        for (const col of ctx.R.columns) {
            if (col.primary < 0) continue;
            row[col.name] = cellAt(ctx.rows, r, col.primary);
            interp[col.name] = exposeInterp(col, interpAt(ctx, col, r));
        }
        return { row, interp };
    }

    function customCheckReturnGuard(res, chk, phase, keyOf, rec, rowForError) {
        if (!Array.isArray(res)) {
            rec.record(phase, 'error', `customFunctionError:${chk.name}`, [{
                row: rowForError, field: null,
                context: { fn: chk.fn, errorMessage: 'custom check returned a non-array result' },
            }], 'customFunctionError');
        }
        const seen = new Set();
        for (const item of res) {
            if (!isObj(item) || !isStr(item.field) || !keyOf.fieldOk(item.field) ||
                typeof item.pass !== 'boolean' ||
                (keyOf.needsRow && !(isIntN(item.row) && item.row >= 0 && item.row < keyOf.rowCount))) {
                rec.record(phase, 'error', `customFunctionError:${chk.name}`, [{
                    row: rowForError, field: null,
                    context: { fn: chk.fn, errorMessage: 'custom check returned a malformed result entry' },
                }], 'customFunctionError');
            }
            if (!item.pass) {
                const k = keyOf.fn(item);
                if (seen.has(k)) {
                    rec.record(phase, 'error', `customFunctionContractViolation:${chk.name}`, [{
                        row: rowForError, field: null,
                        context: { fn: chk.fn, duplicateKey: k },
                    }], 'customFunctionContractViolation');
                }
                seen.add(k);
            }
        }
    }

    function phase8(ctx) {
        const { R, rows, rec, functions } = ctx;
        const P = 'rowCrossColumnChecks';

        for (let r = 0; r < rows.length; r++) {
            for (const chk of R.rowChecks) {
                const rule = (base) => `${base}:${chk.name}`;

                if (chk.type === 'comparison') {
                    const ca = R.columnsByName.get(chk.fieldA);
                    const cb = R.columnsByName.get(chk.fieldB);
                    const ia = interpAt(ctx, ca, r);
                    const ib = interpAt(ctx, cb, r);
                    if (ia.k !== 2 || ib.k !== 2) continue;               // skipped (Core §7.1)
                    if (!opHolds(chk.op, compareInterp(ca, ia, ib))) {
                        const cx = { fieldA: chk.fieldA, fieldB: chk.fieldB, op: chk.op };
                        rec.record(P, chk.severity, rule('comparison'), [
                            { row: r, field: chk.fieldA, value: ca.primary < 0 ? null : cellAt(rows, r, ca.primary), context: cx },
                            { row: r, field: chk.fieldB, value: cb.primary < 0 ? null : cellAt(rows, r, cb.primary), context: cx },
                        ]);
                    }
                } else if (chk.type === 'conditionalRequired') {
                    const ic = R.columnsByName.get(chk.if.field);
                    const tc = R.columnsByName.get(chk.then.field);
                    const iv = interpAt(ctx, ic, r);
                    if (iv.k !== 2) continue;                              // condition not met
                    let cmp;
                    if (TEMPORAL[ic.tn]) cmp = iv.cmp - chk.ifCmp;
                    else if (typeof iv.v === 'number') cmp = iv.v - chk.if.value;
                    else if (typeof iv.v === 'boolean') cmp = iv.v === chk.if.value ? 0 : 1;
                    else if (ic.tn === 'categorical') {
                        const ms = ic.type.matchStrategy;
                        cmp = applyStrategy(canonical(iv.v), ms) === applyStrategy(canonical(chk.if.value), ms) ? 0 : 1;
                    } else cmp = cpCompare(iv.v, chk.if.value);
                    if (!opHolds(chk.if.op, cmp)) continue;
                    const thenCell = tc.primary < 0 ? null : cellAt(rows, r, tc.primary);
                    if (effNull(tc, thenCell)) {
                        const cx = {
                            ifField: chk.if.field, ifOp: chk.if.op,
                            ifValue: chk.if.value, thenField: chk.then.field,
                        };
                        rec.record(P, chk.severity, rule('conditionalRequired'), [
                            { row: r, field: chk.if.field, value: ic.primary < 0 ? null : cellAt(rows, r, ic.primary), context: cx },
                            { row: r, field: chk.then.field, value: thenCell, context: cx },
                        ]);
                    }
                } else if (chk.type === 'nonNullCount') {
                    const nonNull = chk.fields.filter((f) => {
                        const c = R.columnsByName.get(f);
                        return interpAt(ctx, c, r).k !== 0;                // uninterpretable counts as non-null
                    });
                    if (nonNull.length !== chk.expected) {
                        const cx = { fields: chk.fields.slice(), expected: chk.expected, actual: nonNull.length };
                        rec.record(P, chk.severity, rule('nonNullCount'), chk.fields.map((f) => {
                            const c = R.columnsByName.get(f);
                            return { row: r, field: f, value: c.primary < 0 ? null : cellAt(rows, r, c.primary), context: cx };
                        }));
                    }
                } else if (chk.type === 'cooccurrence') {
                    const present = [], missing = [];
                    for (const f of chk.fields) {
                        const c = R.columnsByName.get(f);
                        (interpAt(ctx, c, r).k !== 0 ? present : missing).push(f);
                    }
                    if (present.length > 0 && missing.length > 0) {
                        const cx = { fields: chk.fields.slice(), presentFields: present, missingFields: missing };
                        rec.record(P, chk.severity, rule('cooccurrence'), chk.fields.map((f) => {
                            const c = R.columnsByName.get(f);
                            return { row: r, field: f, value: c.primary < 0 ? null : cellAt(rows, r, c.primary), context: cx };
                        }));
                    }
                } else {                                                    // custom
                    const maps = buildRowMaps(ctx, r);
                    let res;
                    try {
                        res = functions[chk.fn](maps.row, maps.interp, r, chk.params);
                    } catch (err) {
                        rec.record(P, 'error', `customFunctionError:${chk.name}`, [{
                            row: r, field: null,
                            context: { fn: chk.fn, errorMessage: String(err && err.message || err) },
                        }], 'customFunctionError');
                    }
                    customCheckReturnGuard(res, chk, P, {
                        needsRow: false,
                        fieldOk: (f) => R.columnsByName.has(f),
                        fn: (item) => item.field,
                    }, rec, r);
                    for (const item of res) {
                        if (item.pass) continue;
                        const c = R.columnsByName.get(item.field);
                        rec.record(P, chk.severity, rule('custom'), [{
                            row: r, field: item.field,
                            value: c && c.primary >= 0 ? cellAt(rows, r, c.primary) : null,
                            context: { fn: chk.fn, userMessage: item.message != null ? item.message : null },
                        }]);
                    }
                }
            }
        }
    }

    // ================================================================
    // Phase 9 — table-level checks
    // ================================================================

    function phase9(ctx) {
        const { R, rows, rec, functions } = ctx;
        const P = 'tableChecks';

        for (const chk of R.tableChecks) {
            const rule = (base) => `${base}:${chk.name}`;

            if (chk.type === 'monotonic') {
                const col = R.columnsByName.get(chk.field);
                if (col.primary < 0) continue;
                let prev = null;
                for (let r = 0; r < rows.length; r++) {
                    const i = interpAt(ctx, col, r);
                    if (i.k !== 2) continue;                                // skip null/uninterpretable
                    if (prev !== null) {
                        const cmp = compareInterp(col, i, prev);
                        const ok = chk.direction === 'increasing' ? cmp > 0
                            : chk.direction === 'decreasing' ? cmp < 0
                                : chk.direction === 'nonDecreasing' ? cmp >= 0 : cmp <= 0;
                        if (!ok) {
                            rec.record(P, chk.severity, rule('monotonic'), [{
                                row: r, field: chk.field, value: cellAt(rows, r, col.primary),
                                context: { field: chk.field, direction: chk.direction },
                            }]);
                        }
                    }
                    prev = i;                                               // breaking value becomes the reference
                }
            } else if (chk.type === 'sequenceNoGaps') {
                const col = R.columnsByName.get(chk.field);
                if (col.primary < 0) continue;
                const parts = [];
                for (let r = 0; r < rows.length; r++) {
                    const i = interpAt(ctx, col, r);
                    if (i.k === 2) parts.push({ row: r, v: i.v });
                }
                if (parts.length === 0) continue;
                const entry = (r, kind, expectedValue, actualValue) => rec.record(P, chk.severity,
                    rule('sequenceNoGaps'), [{
                        row: r, field: chk.field, value: cellAt(rows, r, col.primary),
                        context: { field: chk.field, kind, expectedValue, actualValue },
                    }]);

                let inRun = parts;
                if (chk.start != null) {
                    for (const p of parts) {
                        if (p.v < chk.start) entry(p.row, 'belowStart', null, p.v);
                    }
                    inRun = parts.filter((p) => p.v >= chk.start);
                }
                const S = chk.start != null ? chk.start
                    : inRun.reduce((m, p) => Math.min(m, p.v), Infinity);
                const k = inRun.length;
                const byVal = new Map();
                for (const p of inRun) {
                    if (!byVal.has(p.v)) byVal.set(p.v, []);
                    byVal.get(p.v).push(p.row);
                }
                for (let e = S; e < S + k; e++) {                           // gaps, ascending
                    if (byVal.has(e)) continue;
                    let bestV = null;
                    for (const v of byVal.keys()) {
                        if (v > e && (bestV === null || v < bestV)) bestV = v;
                    }
                    if (bestV === null) {                                    // no greater value present
                        let maxV = -Infinity;
                        for (const v of byVal.keys()) maxV = Math.max(maxV, v);
                        bestV = maxV;
                    }
                    entry(byVal.get(bestV)[0], 'gap', e, bestV);
                }
                for (const [v, rs] of byVal) {                              // duplicates, row order
                    for (let j = 1; j < rs.length; j++) entry(rs[j], 'duplicate', null, v);
                }
            } else if (chk.type === 'sumEquals') {
                const cols = chk.fields.map((n) => R.columnsByName.get(n));
                let sum = 0;
                for (let r = 0; r < rows.length; r++) {                     // row-major accumulation
                    for (const c of cols) {
                        const i = interpAt(ctx, c, r);
                        if (i.k === 2) sum += i.v;                          // null/uninterpretable → 0
                    }
                }
                let expected;
                if (chk.expectedValue != null) expected = chk.expectedValue;
                else {
                    const ec = R.columnsByName.get(chk.expectedField);
                    const er = chk.expectedFieldRow === 'first' ? 0
                        : chk.expectedFieldRow === 'last' ? rows.length - 1 : chk.expectedFieldRow;
                    if (er >= 0 && er < rows.length && ec.primary >= 0) {
                        const i = interpAt(ctx, ec, er);
                        expected = i.k === 2 ? i.v : 0;
                    } else expected = 0;
                }
                if (Math.abs(sum - expected) > chk.tolerance) {
                    const cx = {
                        fields: chk.fields.slice(), expectedSum: expected,
                        actualSum: sum, tolerance: chk.tolerance,
                    };
                    const entries = [];                                      // ONE violation, R×S entries
                    for (let r = 0; r < rows.length; r++) {
                        for (const c of cols) {
                            entries.push({
                                row: r, field: c.name,
                                value: c.primary < 0 ? null : cellAt(rows, r, c.primary),
                                context: cx,
                            });
                        }
                    }
                    rec.record(P, chk.severity, rule('sumEquals'), entries);
                }
            } else {                                                         // custom
                const rowsArr = [], interpArr = [];
                for (let r = 0; r < rows.length; r++) {
                    const m = buildRowMaps(ctx, r);
                    rowsArr.push(m.row);
                    interpArr.push(m.interp);
                }
                let res;
                try {
                    res = functions[chk.fn](rowsArr, interpArr, chk.params);
                } catch (err) {
                    rec.record(P, 'error', `customFunctionError:${chk.name}`, [{
                        row: null, field: null,
                        context: { fn: chk.fn, errorMessage: String(err && err.message || err) },
                    }], 'customFunctionError');
                }
                customCheckReturnGuard(res, chk, P, {
                    needsRow: true,
                    rowCount: rows.length,
                    fieldOk: (f) => R.columnsByName.has(f),
                    fn: (item) => `(${item.row}, ${item.field})`,
                }, rec, null);
                for (const item of res) {
                    if (item.pass) continue;
                    const c = R.columnsByName.get(item.field);
                    rec.record(P, chk.severity, rule('custom'), [{
                        row: item.row, field: item.field,
                        value: c && c.primary >= 0 && item.row < rows.length
                            ? cellAt(rows, item.row, c.primary) : null,
                        context: { fn: chk.fn, userMessage: item.message != null ? item.message : null },
                    }]);
                }
            }
        }
    }

    // ================================================================
    // validate() — the public entry point
    // ================================================================

    function readConfigDefensively(schema) {
        const rc = isObj(schema) && isObj(schema.resultConfig) ? schema.resultConfig : {};
        return {
            maxSamples: isIntN(rc.maxSamples) && rc.maxSamples >= 1 ? rc.maxSamples : 5,
            maxErrors: isIntN(rc.maxErrors) && rc.maxErrors >= 1 ? rc.maxErrors : null,
            maxErrorsPerColumn: isIntN(rc.maxErrorsPerColumn) && rc.maxErrorsPerColumn >= 1
                ? rc.maxErrorsPerColumn : null,
            collectCellRegister: rc.collectCellRegister === true,
            collectCellObservations: rc.collectCellObservations === true,
            stopPolicy: rc.stopPolicy === 'firstError' ? 'firstError' : 'never',
        };
    }

    // F4: build a message renderer honoring options.messageTemplates
    function makeRender(options) {
        const templates = isObj(options) && isObj(options.messageTemplates) ? options.messageTemplates : null;
        return templates ? (rn, ctx) => renderMessage(rn, ctx, templates) : renderMessage;
    }

    function schemaNeedsTemporal(schema) {
        if (!isObj(schema) || !isObj(schema.columns)) return false;
        for (const def of Object.values(schema.columns)) {
            if (isObj(def) && isObj(def.type) && TEMPORAL[def.type.name]) return true;
        }
        return false;
    }

    function validate(schema, table, options) {
        // --- caller errors (thrown; JS spec §3.1/§3.5) ---
        if (!isObj(schema)) throw new TableValidationConfigError('schema must be a plain object');
        if (!isObj(table)) throw new TableValidationConfigError('table must be a TableInput object');
        const headers = table.headers === undefined ? null : table.headers;
        if (headers !== null && !(Array.isArray(headers) && headers.every(isStr))) {
            throw new TableValidationConfigError('table.headers must be an array of strings or null');
        }
        const rows = table.rows;
        if (!Array.isArray(rows) || rows.some((r) => !Array.isArray(r))) {
            throw new TableValidationConfigError('table.rows must be an array of arrays');
        }
        const opts = options === undefined || options === null ? {} : options;
        if (!isObj(opts)) throw new TableValidationConfigError('options must be an object');
        const functions = opts.functions === undefined || opts.functions === null ? {} : opts.functions;
        if (!isObj(functions)) throw new TableValidationConfigError('options.functions must be an object');
        const refRaw = opts.referenceInstant === undefined ? null : opts.referenceInstant;
        if (refRaw !== null && !(refRaw instanceof Date) && !isStr(refRaw)) {
            throw new TableValidationConfigError('options.referenceInstant must be a Date, ISO 8601 string, or null');
        }
        if (schemaNeedsTemporal(schema)) {
            getLuxon();                     // required dependency missing → thrown config error
            makeReferenceInstant(refRaw);   // unusable referenceInstant → thrown config error
        }

        const cfg = readConfigDefensively(schema);
        const rec = makeRecorder(cfg, makeRender(opts));
        const ctx = {
            R: null, headers, rows, rec, cfg, functions,
            rowsChecked: 0, columnsChecked: 0,
            obs: cfg.collectCellObservations ? [] : null,
        };

        try {
            // Phase 1 — schema self-validation (content errors abort, not throw)
            try {
                validateSchemaPhase1(schema, functions);
            } catch (e) {
                if (e && e.__tvSchemaFail) {
                    rec.record('schemaValidation', 'error', 'schemaValidationError', [{
                        row: null, field: '_schema', context: e.__tvSchemaFail,
                    }], 'schemaInvalid');
                }
                throw e;
            }

            ctx.R = resolveSchema(schema, rec);          // Phase 2
            runtimeResolve(ctx.R, refRaw);               // Phase 3
            phase4(ctx);                                 // Phase 4 (+ GATE 1 via abort)
            phase5(ctx);                                 // Phase 5
            ctx.rowsChecked = rows.length;
            if (rows.length > 0) {                       // GATE 2
                phase6(ctx);
                phase7(ctx);
                phase8(ctx);
                phase9(ctx);
            }
        } catch (sig) {
            if (sig !== ABORT && sig !== STOP) throw sig;
        }

        return rec.finalize({
            rowsChecked: ctx.rowsChecked,
            columnsChecked: ctx.columnsChecked,
            columnMatching: isObj(schema.structure) && schema.structure.columnMatching !== undefined
                ? schema.structure.columnMatching : 'byName',
            cellObservations: ctx.obs,
        });
    }

    // ================================================================
    // buildReport — pure function over result.summary (Core §9.3)
    // ================================================================

    function buildReport(result) {
        if (!isObj(result) || !isObj(result.summary)) {
            throw new TableValidationConfigError('buildReport expects a validation result object');
        }
        const s = result.summary;
        const sev = s.bySeverity;
        const verdict = result.aborted ? 'aborted'
            : sev.error > 0 ? 'fail'
                : sev.warning > 0 ? 'passWithWarnings' : 'pass';
        const details = s.details;
        const topIssues = details.slice()
            .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.count - a.count)
            .slice(0, 5)
            .map((d) => ({
                severity: d.severity, ruleName: d.ruleName, fieldName: d.fieldName,
                count: d.count, message: d.message,
            }));
        return {
            verdict,
            needsAttention: sev.error + sev.warning > 0 || result.aborted === true,
            rowsChecked: s.rowsChecked,
            columnsChecked: s.columnsChecked,
            bySeverity: Object.assign({}, sev),
            checksFailed: new Set(details.map((d) => d.ruleName)).size,
            columnsAffected: new Set(details.filter((d) => d.fieldName != null).map((d) => d.fieldName)).size,
            topIssues,
            aborted: result.aborted === true,
            abortReason: result.abortReason != null ? result.abortReason : null,
            truncated: result.truncated,
            truncationReason: result.truncationReason,
        };
    }

    // ================================================================
    // Input adapters (JS spec §3.4)
    // ================================================================

    function fromArrays(data, opts) {
        if (!Array.isArray(data) || data.some((r) => !Array.isArray(r))) {
            throw new TableValidationConfigError('fromArrays expects an array of arrays');
        }
        const hasHeaderRow = isObj(opts) && opts.hasHeaderRow === true;
        if (hasHeaderRow) {
            return {
                headers: data.length ? data[0].map((c) => String(c)) : [],
                rows: data.slice(1).map((r) => r.slice()),
            };
        }
        return { headers: null, rows: data.map((r) => r.slice()) };
    }

    function fromObjects(records) {
        if (!Array.isArray(records) || records.some((r) => !isObj(r))) {
            throw new TableValidationConfigError('fromObjects expects an array of plain objects');
        }
        const headers = [];
        const seen = new Set();
        for (const rec of records) {
            for (const k of Object.keys(rec)) {
                if (!seen.has(k)) { seen.add(k); headers.push(k); }
            }
        }
        return {
            headers,
            rows: records.map((rec) => headers.map((k) => (k in rec ? rec[k] : null))),
        };
    }

    // ================================================================
    // exportXlsx (Core §9.4, JS spec §4.5) — requires ExcelJS global
    // ================================================================

    const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const STYLE = {
        error: { fill: 'FFFFC7CE', font: 'FF9C0006', bold: false },
        warning: { fill: 'FFFFEB9C', font: 'FF9C6500', bold: false },
        interpreted: { fill: 'FFDDEBF7', font: 'FF2F5496', bold: false },   // F6 annotated: string-coerced
    };

    function colLetter(n) {                       // 0-based → A, B, … AA …
        let s = '';
        n = n + 1;
        while (n > 0) {
            const m = (n - 1) % 26;
            s = String.fromCharCode(65 + m) + s;
            n = Math.floor((n - 1) / 26);
        }
        return s;
    }

    function styleCell(cell, sev) {
        const st = STYLE[sev];
        if (!st) return;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.fill } };
        cell.font = Object.assign({}, cell.font, { color: { argb: st.font }, bold: st.bold });
    }

    function finishSheet(ws, colCount, rowCount) {
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        ws.autoFilter = { from: 'A1', to: `${colLetter(colCount - 1)}${Math.max(rowCount, 1)}` };
        const hdr = ws.getRow(1);
        for (let c = 1; c <= colCount; c++) {
            const cell = hdr.getCell(c);
            cell.font = Object.assign({}, cell.font, { bold: true });
            if (!cell.fill || cell.fill.pattern === undefined) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
            }
            cell.border = Object.assign({}, cell.border, { bottom: { style: 'thin' } });
        }
        for (let c = 1; c <= colCount; c++) {
            let longest = 0;
            ws.getColumn(c).eachCell({ includeEmpty: false }, (cell) => {
                const t = cell.value == null ? ''
                    : (isObj(cell.value) && cell.value.text !== undefined ? cell.value.text : String(cell.value));
                longest = Math.max(longest, t.length);
            });
            ws.getColumn(c).width = Math.max(10, Math.min(longest + 2, 60));
        }
    }

    // JS spec §3.6: exporters accept an optional `messageTemplates` field and render
    // through renderMessage, so localized workbooks need no post-processing.
    function exportMsgOf(args) {
        const tmpl = isObj(args) && isObj(args.messageTemplates) ? args.messageTemplates : null;
        return (x) => tmpl && x.ruleName ? renderMessage(x.ruleName, x.context || {}, tmpl) : x.message;
    }

    async function exportXlsx(args) {
        const ExcelJS = global.ExcelJS;
        if (!ExcelJS) {
            throw new TableValidationConfigError(
                'The ExcelJS global (globalThis.ExcelJS) is required by exportXlsx but is not loaded.');
        }
        if (!isObj(args) || !isObj(args.result) || !isObj(args.table) || !isObj(args.schema)) {
            throw new TableValidationConfigError('exportXlsx expects { result, table, schema }');
        }
        const { result, table, schema } = args;
        const msgOf = exportMsgOf(args);
        if (!Array.isArray(result.cellRegister)) {
            throw new TableValidationConfigError(
                'exportXlsx requires result.cellRegister (run validate with resultConfig.collectCellRegister: true)');
        }

        // re-derive the column mapping deterministically from the same schema/table
        const dummyRec = { record() { } };
        const R = resolveSchema(schema, dummyRec);
        const headers = table.headers === undefined ? null : table.headers;
        const rows = table.rows;
        // byName without headers cannot map (validation halted with headersMissing);
        // fall back to positional layout so the Data sheet still has a header row.
        let Reff = R;
        if (R.structure.columnMatching === 'byName' && !Array.isArray(headers)) {
            Reff = Object.assign({}, R, {
                structure: Object.assign({}, R.structure, { columnMatching: 'byPosition' }),
            });
        }
        const M = deriveMapping(Reff, headers, rows, null);

        const register = result.cellRegister;
        const nonInfo = register.filter((e) => e.severity !== 'info');

        // ---- display column layout (Data sheet)
        // displayCols: { name, tableIdx | null (missing-column placeholder), schemaName | null }
        const displayCols = [];
        for (let i = 0; i < M.tableColCount; i++) {
            displayCols.push({ name: M.displayNames[i], tableIdx: i, schemaName: null });
        }
        for (const col of R.columns) {
            if (col.primary >= 0) displayCols[col.primary].schemaName = col.name;
        }
        const missingEntries = [];
        const seenMissing = new Set();
        for (const e of register) {
            if (e.ruleName === 'requiredColumnMissing' && e.field != null && !seenMissing.has(e.field)) {
                seenMissing.add(e.field);
                missingEntries.push(e);
            }
        }
        if (M.mode === 'byPosition') {
            missingEntries
                .slice()
                .sort((a, b) => (a.context.expectedPosition || 0) - (b.context.expectedPosition || 0))
                .forEach((e) => {
                    const pos = Math.min(e.context.expectedPosition != null ? e.context.expectedPosition : displayCols.length,
                        displayCols.length);
                    displayCols.splice(pos, 0, { name: e.field, tableIdx: null, schemaName: e.field });
                });
        } else {
            for (const e of missingEntries) {
                displayCols.push({ name: e.field, tableIdx: null, schemaName: e.field });
            }
        }
        const fieldToDisplay = new Map();
        displayCols.forEach((dc, i) => {
            if (dc.schemaName != null && !fieldToDisplay.has(dc.schemaName)) fieldToDisplay.set(dc.schemaName, i);
        });

        const wb = new ExcelJS.Workbook();
        const wsSummary = wb.addWorksheet('Summary');
        const wsErrors = wb.addWorksheet('Errors');
        const wsData = wb.addWorksheet('Data');

        // ---- Sheet 3: Data (built first; Errors links into it)
        wsData.addRow(displayCols.map((dc) => dc.name));
        if (M.mode === 'byPosition') {
            wsData.getCell('A1').note =
                'Header row synthesized from schema column names (byPosition mode); the input table is headerless.';
        }
        for (let r = 0; r < rows.length; r++) {
            wsData.addRow(displayCols.map((dc) => {
                if (dc.tableIdx == null) return null;
                const v = cellAt(rows, r, dc.tableIdx);
                return v === null ? null : v;
            }));
        }

        // highlights
        const cellStatus = new Map();        // "row|field" → best sev rank
        const colStatus = new Map();         // field → best sev rank
        const rowStatus = new Map();         // row → best sev rank
        for (const e of nonInfo) {
            const rank = SEV_RANK[e.severity];
            if (e.row != null && e.field != null) {
                const k = e.row + '|' + e.field;
                if (!cellStatus.has(k) || rank < cellStatus.get(k)) cellStatus.set(k, rank);
            } else if (e.field != null) {
                if (!colStatus.has(e.field) || rank < colStatus.get(e.field)) colStatus.set(e.field, rank);
            } else if (e.row != null) {
                if (!rowStatus.has(e.row) || rank < rowStatus.get(e.row)) rowStatus.set(e.row, rank);
            }
        }
        const SEV_BY_RANK = ['error', 'warning'];
        for (const [field, rank] of colStatus) {
            const di = fieldToDisplay.get(field);
            if (di !== undefined) styleCell(wsData.getRow(1).getCell(di + 1), SEV_BY_RANK[rank]);
        }
        for (const [key, rank] of cellStatus) {
            const [rs, field] = key.split('|');
            const di = fieldToDisplay.get(field);
            if (di !== undefined) styleCell(wsData.getRow(Number(rs) + 2).getCell(di + 1), SEV_BY_RANK[rank]);
        }
        for (const [r, rank] of rowStatus) {
            const xr = wsData.getRow(r + 2);
            displayCols.forEach((dc, i) => {
                const k = r + '|' + (dc.schemaName != null ? dc.schemaName : '');
                const cellRank = cellStatus.has(k) ? cellStatus.get(k) : Infinity;
                if (rank < cellRank) styleCell(xr.getCell(i + 1), SEV_BY_RANK[rank]);
            });
        }
        finishSheet(wsData, displayCols.length, rows.length + 1);

        // ---- Sheet 2: Errors
        wsErrors.addRow(['#', 'Severity', 'Check', 'Column', 'Row', 'Value', 'Message', 'Go To']);
        const posOf = (e) => {
            if (e.field == null) return -1;
            const di = fieldToDisplay.get(e.field);
            return di === undefined ? -1 : di;
        };
        const sorted = nonInfo.slice().sort((a, b) =>
            SEV_RANK[a.severity] - SEV_RANK[b.severity] ||
            ((a.row == null ? -1 : a.row) - (b.row == null ? -1 : b.row)) ||
            (posOf(a) - posOf(b)));
        sorted.forEach((e, i) => {
            let target;
            const di = e.field != null ? fieldToDisplay.get(e.field) : undefined;
            if (e.row != null && di !== undefined) target = `#'Data'!${colLetter(di)}${e.row + 2}`;
            else if (di !== undefined) target = `#'Data'!${colLetter(di)}1`;
            else if (e.row != null) target = `#'Data'!A${e.row + 2}`;
            else target = `#'Data'!A1`;
            const row = wsErrors.addRow([
                i + 1,
                e.severity.toUpperCase(),
                e.ruleName,
                e.field != null ? e.field : '—',
                e.row != null ? e.row + 1 : '—',
                e.value == null ? '' : canonical(e.value),
                msgOf(e),
                { hyperlink: target, text: '→ cell' },
            ]);
            styleCell(row.getCell(2), e.severity);
        });
        finishSheet(wsErrors, 8, sorted.length + 1);

        // ---- Sheet 1: Summary
        wsSummary.addRow(['Severity', 'Check', 'Column', 'Message', 'Count', 'First Row', 'Sample Values']);
        const details = result.summary.details.slice().sort((a, b) =>
            SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.count - a.count ||
            (a.ruleName < b.ruleName ? -1 : a.ruleName > b.ruleName ? 1 : 0));
        for (const d of details) {
            const row = wsSummary.addRow([
                d.severity.toUpperCase(),
                d.ruleName,
                d.fieldName != null ? d.fieldName : '—',
                msgOf(d),
                d.count,
                d.firstOccurrenceRow != null ? d.firstOccurrenceRow + 1 : '—',
                d.topSampleValues.map((s) => `${s.value} (×${s.frequency})`).join('; '),
            ]);
            styleCell(row.getCell(1), d.severity);
        }
        finishSheet(wsSummary, 7, details.length + 1);

        const buffer = await wb.xlsx.writeBuffer();
        return new Blob([buffer], { type: XLSX_MIME });
    }

    // ================================================================
    // exportAnnotatedXlsx (F6) — the validated table tinted per cell observation
    // ================================================================

    async function exportAnnotatedXlsx(args) {
        const ExcelJS = global.ExcelJS;
        if (!ExcelJS) {
            throw new TableValidationConfigError(
                'The ExcelJS global (globalThis.ExcelJS) is required by exportAnnotatedXlsx but is not loaded.');
        }
        if (!isObj(args) || !isObj(args.result) || !isObj(args.table) || !isObj(args.schema)) {
            throw new TableValidationConfigError('exportAnnotatedXlsx expects { result, table, schema }');
        }
        const { result, table, schema } = args;
        if (!Array.isArray(result.cellObservations)) {
            throw new TableValidationConfigError(
                'exportAnnotatedXlsx requires result.cellObservations (run validate with resultConfig.collectCellObservations: true)');
        }
        const R = resolveSchema(schema, { record() { } });
        const headers = table.headers === undefined ? null : table.headers;
        const rows = table.rows;
        let Reff = R;
        if (R.structure.columnMatching === 'byName' && !Array.isArray(headers)) {
            Reff = Object.assign({}, R, {
                structure: Object.assign({}, R.structure, { columnMatching: 'byPosition' }),
            });
        }
        const M = deriveMapping(Reff, headers, rows, null);
        const fieldToPos = new Map();          // logical column name → table position
        for (const col of R.columns) if (col.primary >= 0) fieldToPos.set(col.name, col.primary);

        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Annotated');
        ws.addRow(M.displayNames.slice());
        for (let r = 0; r < rows.length; r++) {
            ws.addRow(M.displayNames.map((_, i) => {
                const v = cellAt(rows, r, i);
                return v === null ? null : v;
            }));
        }
        // tint by observation outcome
        for (const o of result.cellObservations) {
            const pos = fieldToPos.get(o.field);
            if (pos === undefined) continue;
            let tier = null;
            if (o.outcome === 'violation') tier = o.worstSeverity;       // error | warning
            else if (o.outcome === 'interpreted') tier = 'interpreted';
            if (tier) styleCell(ws.getRow(o.row + 2).getCell(pos + 1), tier);
        }
        finishSheet(ws, M.displayNames.length, rows.length + 1);
        const buffer = await wb.xlsx.writeBuffer();
        return new Blob([buffer], { type: XLSX_MIME });
    }

    // ================================================================
    // Comparison engine (Core §15) — fuzzy metrics
    // ================================================================

    function levDistance(a, b) {
        const A = Array.from(a), B = Array.from(b);
        const m = A.length, n = B.length;
        if (m === 0) return n;
        if (n === 0) return m;
        let prev = new Array(n + 1);
        for (let j = 0; j <= n; j++) prev[j] = j;
        for (let i = 1; i <= m; i++) {
            let cur = [i];
            for (let j = 1; j <= n; j++) {
                const cost = A[i - 1] === B[j - 1] ? 0 : 1;
                cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            }
            prev = cur;
        }
        return prev[n];
    }

    function levSim(a, b) {
        const m = Math.max(Array.from(a).length, Array.from(b).length);
        return m === 0 ? 1 : 1 - levDistance(a, b) / m;
    }

    function jaroSim(a, b) {
        const A = Array.from(a), B = Array.from(b);
        if (A.length === 0 && B.length === 0) return 1;
        if (A.length === 0 || B.length === 0) return 0;
        const md = Math.max(0, Math.floor(Math.max(A.length, B.length) / 2) - 1);
        const aM = new Array(A.length).fill(false), bM = new Array(B.length).fill(false);
        let matches = 0;
        for (let i = 0; i < A.length; i++) {
            const lo = Math.max(0, i - md), hi = Math.min(i + md + 1, B.length);
            for (let j = lo; j < hi; j++) {
                if (!bM[j] && A[i] === B[j]) { aM[i] = bM[j] = true; matches++; break; }
            }
        }
        if (matches === 0) return 0;
        let t = 0, k = 0;
        for (let i = 0; i < A.length; i++) {
            if (!aM[i]) continue;
            while (!bM[k]) k++;
            if (A[i] !== B[k]) t++;
            k++;
        }
        t /= 2;
        return (matches / A.length + matches / B.length + (matches - t) / matches) / 3;
    }

    function jaroWinklerSim(a, b) {
        const j = jaroSim(a, b);
        const A = Array.from(a), B = Array.from(b);
        let p = 0;
        while (p < 4 && p < A.length && p < B.length && A[p] === B[p]) p++;
        return j + p * 0.1 * (1 - j);
    }

    function tokenize(s) {
        return s.split(/[\s\p{P}\p{S}]+/u).filter(Boolean);
    }

    // greedy token alignment with per-token Levenshtein similarity, Dice-aggregated
    function tokenizedFuzzySim(a, b) {
        const P = tokenize(a), E = tokenize(b);
        if (P.length === 0 && E.length === 0) return 1;
        if (P.length === 0 || E.length === 0) return 0;
        const used = new Array(E.length).fill(false);
        let sum = 0;
        for (const pt of P) {
            let best = -1, bestIdx = -1;
            for (let j = 0; j < E.length; j++) {
                if (used[j]) continue;
                const s = levSim(pt, E[j]);
                if (s > best) { best = s; bestIdx = j; }
            }
            if (bestIdx >= 0) { used[bestIdx] = true; sum += best; }
        }
        return (2 * sum) / (P.length + E.length);
    }

    function fuzzySim(metric, a, b) {
        if (metric === 'jaroWinkler') return jaroWinklerSim(a, b);
        if (metric === 'levenshtein') return levSim(a, b);
        return tokenizedFuzzySim(a, b);        // default
    }

    // ================================================================
    // Comparison engine — config validation (Core §15.12, rules C1–C9)
    // ================================================================

    function validateComparisonConfig(schema, functions) {
        const c = schema.comparison;
        p1unit(() => { if (!isObj(c)) schemaFail('comparison', 'comparison config object (compare() requires it)', c); });
        if (!isObj(c)) return;
        const colNames = isObj(schema.columns) ? Object.keys(schema.columns) : [];
        const colType = (n) => isObj(schema.columns[n]) && isObj(schema.columns[n].type) ? schema.columns[n].type.name : undefined;

        // C1 match.keys
        p1unit(() => {
            if (!isObj(c.match)) schemaFail('comparison.match', 'object', c.match);
            if (!(Array.isArray(c.match.keys) && c.match.keys.length >= 1 && c.match.keys.every(isStr))) {
                schemaFail('comparison.match.keys', 'non-empty array of column names', c.match.keys);
            }
            for (const k of c.match.keys) if (!colNames.includes(k)) schemaFail('comparison.match.keys', 'existing column name', k);
        });
        if (!isObj(c.match)) return;
        // C2 setMode + onDuplicateKey
        p1unit(() => {
            if (c.match.setMode !== undefined && !['exact', 'superset', 'subset'].includes(c.match.setMode)) {
                schemaFail('comparison.match.setMode', '"exact", "superset", or "subset"', c.match.setMode);
            }
        });
        p1unit(() => {
            if (c.match.onDuplicateKey !== undefined && !['abort', 'reportAndExclude'].includes(c.match.onDuplicateKey)) {
                schemaFail('comparison.match.onDuplicateKey', '"abort" or "reportAndExclude"', c.match.onDuplicateKey);
            }
        });
        // C3 fuzzy
        if (c.match.fuzzy !== undefined && c.match.fuzzy !== null) {
            const f = c.match.fuzzy;
            p1unit(() => { if (!isObj(f)) schemaFail('comparison.match.fuzzy', 'object', f); });
            if (isObj(f)) {
                p1unit(() => {
                    if (!(Array.isArray(f.components) && f.components.length >= 1 && f.components.every(isStr))) {
                        schemaFail('comparison.match.fuzzy.components', 'non-empty array of column names', f.components);
                    }
                    for (const k of f.components) if (!colNames.includes(k)) schemaFail('comparison.match.fuzzy.components', 'existing column name', k);
                });
                const okThresh = (v) => isNum(v) && v > 0 && v <= 1;
                p1unit(() => {
                    if (isObj(f.threshold)) {
                        for (const k of Object.keys(f.threshold)) if (!okThresh(f.threshold[k])) schemaFail(`comparison.match.fuzzy.threshold.${k}`, 'number in (0,1]', f.threshold[k]);
                    } else if (!okThresh(f.threshold)) {
                        schemaFail('comparison.match.fuzzy.threshold', 'number in (0,1] or per-component map (required)', f.threshold);
                    }
                });
                p1unit(() => {
                    if (f.metric !== undefined && !['tokenizedFuzzy', 'jaroWinkler', 'levenshtein'].includes(f.metric)) {
                        schemaFail('comparison.match.fuzzy.metric', 'a supported metric', f.metric);
                    }
                });
                p1unit(() => {
                    if (f.ambiguityMargin !== undefined && !(isNum(f.ambiguityMargin) && f.ambiguityMargin >= 0)) {
                        schemaFail('comparison.match.fuzzy.ambiguityMargin', 'number >= 0', f.ambiguityMargin);
                    }
                });
                p1unit(() => {
                    if (f.maxCandidatePairs !== undefined && !(isIntN(f.maxCandidatePairs) && f.maxCandidatePairs >= 1)) {
                        schemaFail('comparison.match.fuzzy.maxCandidatePairs', 'integer >= 1', f.maxCandidatePairs);
                    }
                });
            }
        }
        // C4 fields
        if (c.fields !== undefined) {
            p1unit(() => { if (!isObj(c.fields)) schemaFail('comparison.fields', 'object', c.fields); });
            if (isObj(c.fields)) for (const fn of Object.keys(c.fields)) {
                p1unit(() => { if (!colNames.includes(fn)) schemaFail(`comparison.fields.${fn}`, 'existing column name', fn); });
                const spec = c.fields[fn];
                p1unit(() => { if (!isObj(spec)) schemaFail(`comparison.fields.${fn}`, 'object', spec); });
                if (!isObj(spec)) continue;
                p1unit(() => {
                    if (spec.compare !== undefined && !isBool(spec.compare)) schemaFail(`comparison.fields.${fn}.compare`, 'boolean', spec.compare);
                });
                p1unit(() => {
                    if (spec.presence !== undefined && !['both', 'producedOnly', 'expectedOnly'].includes(spec.presence)) {
                        schemaFail(`comparison.fields.${fn}.presence`, '"both", "producedOnly", or "expectedOnly"', spec.presence);
                    }
                });
                p1unit(() => {                                                            // C4: expected-side alias
                    if (spec.expectedName !== undefined && spec.expectedName !== null &&
                        !(isStr(spec.expectedName) && spec.expectedName.length > 0)) {
                        schemaFail(`comparison.fields.${fn}.expectedName`, 'non-empty string or null', spec.expectedName);
                    }
                });
                p1unit(() => {
                    if (spec.tolerance !== undefined && spec.tolerance !== null) {
                        // colType(fn) undefined only when the column's own defect was already recorded
                        if (colType(fn) !== undefined && colType(fn) !== 'int' && colType(fn) !== 'float') {
                            schemaFail(`comparison.fields.${fn}.tolerance`, 'tolerance only on int/float columns', colType(fn));
                        }
                        const t = spec.tolerance;                                   // C5
                        if (isNum(t)) { if (t < 0) schemaFail(`comparison.fields.${fn}.tolerance`, 'number >= 0', t); }
                        else if (isObj(t)) {
                            if (t.field !== undefined) { if (!colNames.includes(t.field)) schemaFail(`comparison.fields.${fn}.tolerance.field`, 'existing column', t.field); }
                            else if (t.percent !== undefined) { if (!isNum(t.percent) || !isStr(t.of) || !colNames.includes(t.of)) schemaFail(`comparison.fields.${fn}.tolerance`, '{percent, of} with existing column', t); }
                            else if (t.fn !== undefined) { if (typeof functions[t.fn] !== 'function') schemaFail(`comparison.fields.${fn}.tolerance.fn`, 'registered function', t.fn); }
                            else schemaFail(`comparison.fields.${fn}.tolerance`, 'a valid ToleranceSpec', t);
                            if (t.from !== undefined && !['expected', 'produced'].includes(t.from)) schemaFail(`comparison.fields.${fn}.tolerance.from`, '"expected" or "produced"', t.from);
                        } else schemaFail(`comparison.fields.${fn}.tolerance`, 'number or object', t);
                    }
                });
                p1unit(() => {
                    if (spec.fuzzy !== undefined && spec.fuzzy !== null) {
                        if (colType(fn) !== undefined && colType(fn) !== 'string') {
                            schemaFail(`comparison.fields.${fn}.fuzzy`, 'fuzzy only on string columns', colType(fn));
                        }
                        const okThresh = (v) => isNum(v) && v > 0 && v <= 1;
                        if (!isObj(spec.fuzzy) || !okThresh(spec.fuzzy.threshold)) schemaFail(`comparison.fields.${fn}.fuzzy.threshold`, 'number in (0,1]', isObj(spec.fuzzy) ? spec.fuzzy.threshold : spec.fuzzy);
                        if (spec.fuzzy.metric !== undefined && !['tokenizedFuzzy', 'jaroWinkler', 'levenshtein'].includes(spec.fuzzy.metric)) {
                            schemaFail(`comparison.fields.${fn}.fuzzy.metric`, 'a supported metric', spec.fuzzy.metric);
                        }
                    }
                });
            }
        }
        // C6 severity map
        const TIERS = ['toleranceMatch', 'interpretedMatch', 'fuzzyMatch', 'crossTypeMismatch', 'valueMismatch',
            'fuzzyKeyMatch', 'ambiguousFuzzyMatch', 'rowMissing', 'rowUnexpected', 'columnOnlyOnOneSide',
            'duplicateMatchKey'];      // severity-mappable only under onDuplicateKey: "reportAndExclude" (§15.5)
        if (c.severity !== undefined) {
            p1unit(() => { if (!isObj(c.severity)) schemaFail('comparison.severity', 'object', c.severity); });
            if (isObj(c.severity)) for (const k of Object.keys(c.severity)) {
                p1unit(() => {
                    if (!TIERS.includes(k)) schemaFail(`comparison.severity.${k}`, `a configurable tier (${TIERS.join(', ')}); "exact" is not configurable`, k);
                    if (!['none', 'warning', 'error'].includes(c.severity[k])) schemaFail(`comparison.severity.${k}`, '"none", "warning", or "error"', c.severity[k]);
                });
            }
        }
        // C7 scope
        if (c.scope !== undefined && c.scope !== null) {
            const sc = c.scope;
            p1unit(() => { if (!isObj(sc)) schemaFail('comparison.scope', 'object', sc); });
            if (isObj(sc)) {
                p1unit(() => {
                    if (!isStr(sc.column) || !colNames.includes(sc.column)) schemaFail('comparison.scope.column', 'existing column name', sc.column);
                });
                p1unit(() => {
                    const inV = sc.inScopeValues, outV = sc.outOfScopeValues;
                    const nonEmpty = (a) => Array.isArray(a) && a.length > 0;
                    if (!nonEmpty(inV) && !nonEmpty(outV)) schemaFail('comparison.scope', 'at least one of inScopeValues/outOfScopeValues (non-empty)', sc);
                    if (nonEmpty(inV) && nonEmpty(outV)) schemaFail('comparison.scope', 'not both inScopeValues and outOfScopeValues', sc);
                });
                p1unit(() => { if (sc.matchStrategy !== undefined) checkStrategyShape(sc.matchStrategy, 'comparison.scope.matchStrategy'); });
                p1unit(() => {
                    if (sc.outOfScopePolicy !== undefined && !['compare', 'skip'].includes(sc.outOfScopePolicy)) {
                        schemaFail('comparison.scope.outOfScopePolicy', '"compare" or "skip"', sc.outOfScopePolicy);
                    }
                });
            }
        }
        // C8 diffChecks
        if (c.diffChecks !== undefined) {
            p1unit(() => { if (!isObj(c.diffChecks)) schemaFail('comparison.diffChecks', 'object', c.diffChecks); });
            if (isObj(c.diffChecks)) for (const level of ['row', 'table']) {
                const arr = c.diffChecks[level];
                if (arr === undefined) continue;
                p1unit(() => { if (!Array.isArray(arr)) schemaFail(`comparison.diffChecks.${level}`, 'array', arr); });
                if (Array.isArray(arr)) arr.forEach((chk, i) => p1unit(() => {
                    const p = `comparison.diffChecks.${level}[${i}]`;
                    if (!isObj(chk) || !isStr(chk.name) || chk.name.length === 0) schemaFail(`${p}.name`, 'non-empty string', chk && chk.name);
                    if (!['custom', 'orphanRateMax', 'mismatchRateMax'].includes(chk.type)) schemaFail(`${p}.type`, 'valid diff-check type', chk.type);
                    if (chk.severity !== undefined && !['none', 'warning', 'error'].includes(chk.severity)) schemaFail(`${p}.severity`, '"none", "warning", or "error"', chk.severity);
                    if (chk.type === 'custom') {
                        if (typeof functions[chk.fn] !== 'function') schemaFail(`${p}.fn`, 'registered function', chk.fn);
                    } else if (chk.type === 'orphanRateMax') {
                        if (level !== 'table') schemaFail(`${p}.type`, 'orphanRateMax is a table-level check', level);
                        if (!isObj(chk.params) || !(isNum(chk.params.max) && chk.params.max >= 0 && chk.params.max <= 1)) schemaFail(`${p}.params.max`, 'number in [0,1]', chk.params && chk.params.max);
                        if (!['expected', 'produced', 'either'].includes(chk.params.side)) schemaFail(`${p}.params.side`, '"expected", "produced", or "either"', chk.params && chk.params.side);
                    } else {
                        if (level !== 'table') schemaFail(`${p}.type`, 'mismatchRateMax is a table-level check', level);
                        if (!isObj(chk.params) || !(isNum(chk.params.max) && chk.params.max >= 0 && chk.params.max <= 1)) schemaFail(`${p}.params.max`, 'number in [0,1]', chk.params && chk.params.max);
                    }
                }));
            }
        }
    }

    // ================================================================
    // Comparison engine — resolved config + run
    // ================================================================

    const DEFAULT_CMP_SEV = {
        toleranceMatch: 'none', interpretedMatch: 'warning', fuzzyMatch: 'warning',
        crossTypeMismatch: 'error', valueMismatch: 'error',
        fuzzyKeyMatch: 'warning', ambiguousFuzzyMatch: 'warning',
        columnOnlyOnOneSide: 'error',
        duplicateMatchKey: 'error',    // takes effect only under onDuplicateKey: "reportAndExclude"
    };

    function resolveComparison(schema) {
        const c = schema.comparison;
        const m = c.match;
        const setMode = m.setMode || 'exact';
        const onDuplicateKey = m.onDuplicateKey || 'abort';
        const sev = Object.assign({}, DEFAULT_CMP_SEV, isObj(c.severity) ? c.severity : {});
        // rowMissing/rowUnexpected default from setMode unless explicitly set:
        // subset (produced⊆expected) → rowMissing none; superset (produced⊇expected) → rowUnexpected none
        sev.rowMissing = (c.severity && c.severity.rowMissing) || (setMode === 'subset' ? 'none' : 'error');
        sev.rowUnexpected = (c.severity && c.severity.rowUnexpected) || (setMode === 'superset' ? 'none' : 'error');
        const fuzzy = (m.fuzzy && m.fuzzy !== null) ? {
            components: m.fuzzy.components.slice(),
            threshold: m.fuzzy.threshold,
            metric: m.fuzzy.metric || 'tokenizedFuzzy',
            ambiguityMargin: m.fuzzy.ambiguityMargin != null ? m.fuzzy.ambiguityMargin : 0,
            maxCandidatePairs: m.fuzzy.maxCandidatePairs != null ? m.fuzzy.maxCandidatePairs : 1000000,
        } : null;
        const fields = {};
        const rawFields = isObj(c.fields) ? c.fields : {};
        for (const k of Object.keys(rawFields)) {
            const s = rawFields[k];
            fields[k] = {
                compare: s.compare !== undefined ? s.compare : true,
                presence: s.presence || 'both',
                expectedName: s.expectedName != null ? s.expectedName : null,
                tolerance: s.tolerance != null ? s.tolerance : null,
                fuzzy: s.fuzzy != null ? { threshold: s.fuzzy.threshold, metric: s.fuzzy.metric || 'tokenizedFuzzy' } : null,
            };
        }
        const scope = (c.scope && c.scope !== null) ? {
            column: c.scope.column,
            inScope: Array.isArray(c.scope.inScopeValues) ? c.scope.inScopeValues.slice() : [],
            outOfScope: Array.isArray(c.scope.outOfScopeValues) ? c.scope.outOfScopeValues.slice() : [],
            matchStrategy: effStrategy(c.scope.matchStrategy, [false, true, false]),
            outOfScopePolicy: c.scope.outOfScopePolicy || 'compare',
        } : null;
        const diffChecks = {
            row: (isObj(c.diffChecks) && Array.isArray(c.diffChecks.row) ? c.diffChecks.row : []).map((chk) =>
                Object.assign({}, chk, { severity: chk.severity || 'error', params: chk.params || null })),
            table: (isObj(c.diffChecks) && Array.isArray(c.diffChecks.table) ? c.diffChecks.table : []).map((chk) =>
                Object.assign({}, chk, { severity: chk.severity || 'error', params: chk.params || null })),
        };
        return { keys: m.keys.slice(), setMode, onDuplicateKey, fuzzy, fields, sev, scope, diffChecks };
    }

    // fieldCompared: is a column compared cell-by-cell?
    function fieldCompared(C, name) {
        const f = C.fields[name];
        return !f || f.compare !== false;
    }

    // string key/component for exact key matching (interpreted, strict typed equality)
    function keyComponent(R, col, cell) {
        const i = interpretCell(R, col, cell);
        if (i.k === 0) return ['0'];
        if (i.k === 1) return ['u', actualTypeOf(cell), canonical(cell)];
        if (TEMPORAL[col.tn]) return ['t', col.tn, i.cmp];
        if (typeof i.v === 'number') return ['n', i.v];
        if (typeof i.v === 'boolean') return ['b', i.v];
        if (typeof i.v === 'string') return ['s', i.v];
        return ['x', canonical(i.v)];
    }

    // comparison reads raw TableInput rows directly; position = column index
    function cellAt2(row, idx) {
        return idx >= 0 && idx < row.length ? (row[idx] === undefined ? null : row[idx]) : null;
    }

    // per-side column mapping (name → table index, or -1). aliasFor (logical name →
    // header alias) implements comparison.fields.<col>.expectedName on the expected
    // side: matching uses the alias, everything downstream keeps the logical name.
    // byPosition matching is positional, so aliases are ignored (inert; a Phase-2
    // advisory flags them).
    function mapSide(R, table, aliasFor) {
        const headers = table.headers == null ? null : table.headers;
        let width = headers ? headers.length : 0;
        for (const r of table.rows) width = Math.max(width, r.length);
        const idx = new Map();
        if (R.structure.columnMatching === 'byName' && Array.isArray(headers)) {
            const norm = (s) => applyStrategy(s, R.structure.fieldNameMatching);
            const nh = headers.map(norm);
            for (const col of R.columns) {
                const lookup = aliasFor && aliasFor.has(col.name) ? aliasFor.get(col.name) : col.name;
                idx.set(col.name, nh.indexOf(norm(lookup)));
            }
        } else {
            for (const col of R.columns) idx.set(col.name, col.idx < width ? col.idx : -1);
        }
        return { idx, width, headers };
    }

    // interpreted type class (for crossTypeMismatch — meaningful mainly on skip columns)
    function interpClass(col, i) {
        if (TEMPORAL[col.tn]) return col.tn;
        if (col.tn === 'int' || col.tn === 'float') return 'number';
        if (col.tn === 'string' || col.tn === 'categorical') return 'string';
        if (col.tn === 'bool') return 'boolean';
        return typeof i.v;                                  // skip
    }

    function interpEqual(col, pi, ei) {
        if (TEMPORAL[col.tn]) return pi.cmp === ei.cmp;
        return pi.v === ei.v;
    }

    // resolve ε(row) for a numeric tolerance spec
    function resolveTolerance(R, C, col, tol, pRow, eRow, pMap, eMap, rowDiff, functions, cellPair) {
        if (isNum(tol)) return tol;
        if (isObj(tol)) {
            if (tol.fn !== undefined) {
                let v;
                try { v = functions[tol.fn](cellPair, rowDiff, tol.params || null); }
                catch (err) { return { __err: String(err && err.message || err) }; }
                if (!(isNum(v) && v >= 0)) return { __contract: true };
                return v;
            }
            const from = tol.from === 'produced' ? { row: pRow, map: pMap } : { row: eRow, map: eMap };
            if (tol.field !== undefined) {
                const dc = R.columnsByName.get(tol.field);
                const iv = interpretCell(R, dc, cellAt2(from.row || [], from.map.idx.get(tol.field)));
                return iv.k === 2 && typeof iv.v === 'number' ? Math.abs(iv.v) : 0;
            }
            if (tol.percent !== undefined) {
                const dc = R.columnsByName.get(tol.of);
                const iv = interpretCell(R, dc, cellAt2(from.row || [], from.map.idx.get(tol.of)));
                const base = iv.k === 2 && typeof iv.v === 'number' ? Math.abs(iv.v) : 0;
                return base * tol.percent / 100;
            }
        }
        return 0;
    }

    // classify one compared cell (Core §15.4, disjoint tiers)
    function cellOutcome(R, C, col, pCell, eCell, ctxTol) {
        const pi = interpretCell(R, col, pCell), ei = interpretCell(R, col, eCell);
        if (pi.k === 0 && ei.k === 0) return { tier: 'exact', rollup: 'equal', pi, ei };
        if (pi.k === 0 || ei.k === 0) return { tier: 'valueMismatch', rollup: 'different', pi, ei };
        if (pi.k === 1 || ei.k === 1) {                     // uninterpretable → raw-string fallback
            return String(pCell) === String(eCell)
                ? { tier: 'exact', rollup: 'equal', pi, ei }
                : { tier: 'valueMismatch', rollup: 'different', pi, ei };
        }
        if (interpClass(col, pi) !== interpClass(col, ei)) {
            return { tier: 'crossTypeMismatch', rollup: 'different', pi, ei };
        }
        // exact: identical raw form AND same native kind
        if (String(pCell) === String(eCell) && typeof pCell === typeof eCell) {
            return { tier: 'exact', rollup: 'equal', pi, ei };
        }
        if (interpEqual(col, pi, ei)) return { tier: 'interpretedMatch', rollup: 'equivalent', pi, ei };
        // numeric tolerance (0 < |Δ| ≤ ε)
        if ((col.tn === 'int' || col.tn === 'float') && ctxTol && ctxTol.tol != null) {
            const eps = ctxTol.eps;
            if (isNum(eps)) {
                const delta = Math.abs(pi.v - ei.v);
                if (delta <= eps) return { tier: 'toleranceMatch', rollup: 'equivalent', pi, ei, delta, tolerance: eps };
            }
        }
        // cell fuzzy (string)
        const ff = C.fields[col.name] && C.fields[col.name].fuzzy;
        if (col.tn === 'string' && ff) {
            const ms = R.structure.fieldNameMatching;   // reuse a strategy for pre-normalization
            const sim = fuzzySim(ff.metric, applyStrategy(String(pi.v), ms), applyStrategy(String(ei.v), ms));
            if (sim >= ff.threshold) return { tier: 'fuzzyMatch', rollup: 'equivalent', pi, ei, similarity: sim };
        }
        return { tier: 'valueMismatch', rollup: 'different', pi, ei };
    }

    function scopeInScope(R, C, col, cell) {
        const i = interpretCell(R, col, cell);
        const s = i.k === 2 ? applyStrategy(canonical(i.v), C.scope.matchStrategy) : null;
        const listed = (arr) => arr.some((v) => applyStrategy(canonical(v), C.scope.matchStrategy) === s);
        if (C.scope.inScope.length) return s != null && listed(C.scope.inScope);
        if (C.scope.outOfScope.length) return !(s != null && listed(C.scope.outOfScope));
        return true;
    }

    function runComparison(R, C, produced, expected, rec, cfg, functions, diff) {
        const P_STRUCT = 'structuralComparison', P_CELL = 'cellComparison', P_CHK = 'comparisonChecks';
        const eAliases = new Map();
        for (const col of R.columns) {
            const f0 = C.fields[col.name];
            if (f0 && f0.expectedName != null) eAliases.set(col.name, f0.expectedName);
        }
        const pM = mapSide(R, produced), eM = mapSide(R, expected, eAliases.size ? eAliases : null);
        const keyCols = C.keys.map((n) => R.columnsByName.get(n));
        const scopeCol = C.scope ? R.columnsByName.get(C.scope.column) : null;

        // column presence (both-columns missing on a side → columnOnlyOnOneSide)
        const comparedCols = [];
        for (const col of R.columns) {
            const f = C.fields[col.name] || {};
            const presence = f.presence || 'both';
            if (presence === 'producedOnly' || presence === 'expectedOnly') continue;
            const pIdx = pM.idx.get(col.name), eIdx = eM.idx.get(col.name);
            if (pIdx < 0 || eIdx < 0) {
                rec.record(P_STRUCT, C.sev.columnOnlyOnOneSide, 'columnOnlyOnOneSide', [{
                    row: null, field: col.name,
                    context: { field: col.name, presentSide: pIdx >= 0 ? 'produced' : 'expected' },
                }]);
                continue;
            }
            if (fieldCompared(C, col.name)) comparedCols.push(col);
        }

        // build keys + duplicate handling per side (Core §15.6: onDuplicateKey policy)
        const buildKey = (row, map) => JSON.stringify(keyCols.map((col) => keyComponent(R, col, cellAt2(row, map.idx.get(col.name)))));
        const excluded = [];               // { rowIdx, side } under "reportAndExclude", diff-row order
        let pByKey, eByKey;
        if (C.onDuplicateKey === 'abort') {
            // default policy — abort on the first duplicated interpreted key (intrinsic)
            const indexSide = (table, map, side) => {
                const byKey = new Map();
                table.rows.forEach((row, r) => {
                    const k = buildKey(row, map);
                    if (byKey.has(k)) {
                        rec.record(P_STRUCT, 'error', 'duplicateMatchKey', [{
                            row: r, field: null, context: { side, matchKey: JSON.parse(k), rows: [byKey.get(k), r] },
                        }], 'duplicateMatchKey');
                    }
                    byKey.set(k, r);
                });
                return byKey;
            };
            pByKey = indexSide(produced, pM, 'produced');
            eByKey = indexSide(expected, eM, 'expected');
        } else {
            // "reportAndExclude": one duplicateMatchKey violation per duplicated key group
            // (at the configured severity), then the key is excluded from pairing on BOTH
            // sides — key-global exclusion, see the design-decisions log — and every row
            // carrying it is marked "excludedDuplicateKey" in the diff (fact layer complete).
            const groupSide = (table, map) => {
                const groups = new Map();
                table.rows.forEach((row, r) => {
                    const k = buildKey(row, map);
                    if (!groups.has(k)) groups.set(k, []);
                    groups.get(k).push(r);
                });
                return groups;
            };
            const pGroups = groupSide(produced, pM), eGroups = groupSide(expected, eM);
            const poisoned = new Set();
            const reportDups = (groups, side) => {
                for (const [k, rs] of groups) {
                    if (rs.length < 2) continue;
                    poisoned.add(k);
                    const sevD = C.sev.duplicateMatchKey;
                    if (sevD !== 'none' && sevD !== undefined) {
                        rec.record(P_STRUCT, sevD, 'duplicateMatchKey', [{
                            row: null, field: null,
                            context: { side, matchKey: JSON.parse(k), rows: rs, policy: 'reportAndExclude' },
                        }]);
                    }
                }
            };
            reportDups(pGroups, 'produced');
            reportDups(eGroups, 'expected');
            pByKey = new Map(); eByKey = new Map();
            for (const [k, rs] of pGroups) {
                if (poisoned.has(k)) rs.forEach((r) => excluded.push({ rowIdx: r, side: 'produced' }));
                else pByKey.set(k, rs[0]);
            }
            for (const [k, rs] of eGroups) {
                if (poisoned.has(k)) rs.forEach((r) => excluded.push({ rowIdx: r, side: 'expected' }));
                else eByKey.set(k, rs[0]);
            }
        }

        // pairing: exact, then fuzzy on residue, then orphans
        const pairs = [];                 // { pr, er, status, similarity }
        const pUnpaired = new Set(pByKey.values());
        const eUnpaired = new Set(eByKey.values());
        for (const [k, pr] of pByKey) {
            if (eByKey.has(k)) {
                pairs.push({ pr, er: eByKey.get(k), status: 'matched', similarity: null });
                pUnpaired.delete(pr); eUnpaired.delete(eByKey.get(k));
            }
        }
        if (C.fuzzy && pUnpaired.size && eUnpaired.size) {
            if (pUnpaired.size * eUnpaired.size > C.fuzzy.maxCandidatePairs) {
                rec.record(P_STRUCT, 'error', 'duplicateMatchKey', [{     // reuse abort path; distinct reason
                    row: null, field: null, context: { candidatePairs: pUnpaired.size * eUnpaired.size },
                }], 'maxCandidatePairsExceeded');
            }
            const nonFuzzy = keyCols.filter((c) => !C.fuzzy.components.includes(c.name));
            const fuzzyColNames = C.fuzzy.components;
            const thr = (name) => isObj(C.fuzzy.threshold) ? C.fuzzy.threshold[name] : C.fuzzy.threshold;
            const pList = [...pUnpaired].sort((a, b) => a - b);
            for (const pr of pList) {
                if (!pUnpaired.has(pr)) continue;
                let best = null, bestSim = -1, runnerUp = -1;
                for (const er of [...eUnpaired].sort((a, b) => a - b)) {
                    // non-fuzzy key components must be interpreted-equal
                    let ok = true;
                    for (const col of nonFuzzy) {
                        if (keyComponent(R, col, cellAt2(produced.rows[pr], pM.idx.get(col.name))).join('') !==
                            keyComponent(R, col, cellAt2(expected.rows[er], eM.idx.get(col.name))).join('')) { ok = false; break; }
                    }
                    if (!ok) continue;
                    let sim = 1;
                    for (const name of fuzzyColNames) {
                        const col = R.columnsByName.get(name);
                        const ps = canonical(interpretCell(R, col, cellAt2(produced.rows[pr], pM.idx.get(name))).v);
                        const es = canonical(interpretCell(R, col, cellAt2(expected.rows[er], eM.idx.get(name))).v);
                        sim = Math.min(sim, fuzzySim(C.fuzzy.metric, ps, es));
                    }
                    let passes = true;
                    for (const name of fuzzyColNames) {
                        const col = R.columnsByName.get(name);
                        const ps = canonical(interpretCell(R, col, cellAt2(produced.rows[pr], pM.idx.get(name))).v);
                        const es = canonical(interpretCell(R, col, cellAt2(expected.rows[er], eM.idx.get(name))).v);
                        if (fuzzySim(C.fuzzy.metric, ps, es) < thr(name)) { passes = false; break; }
                    }
                    if (!passes) continue;
                    if (sim > bestSim) { runnerUp = bestSim; bestSim = sim; best = er; }
                    else if (sim > runnerUp) runnerUp = sim;
                }
                if (best != null) {
                    const ambiguous = runnerUp >= 0 && (bestSim - runnerUp) <= C.fuzzy.ambiguityMargin;
                    pairs.push({ pr, er: best, status: 'fuzzyMatched', similarity: bestSim, ambiguous });
                    pUnpaired.delete(pr); eUnpaired.delete(best);
                }
            }
        }

        // helper: record an outcome tier at its configured severity (none → diff only)
        const rowDiffs = [];
        let comparedCells = 0, differentCells = 0, equivalentCells = 0;

        const emitTier = (tier, entries) => {
            const sev = C.sev[tier];
            if (sev === 'none' || sev === undefined) return;
            rec.record(P_CELL, sev, tier, entries);
        };

        // matched + fuzzy pairs → cell comparison
        for (const pair of pairs) {
            const pRow = produced.rows[pair.pr], eRow = expected.rows[pair.er];
            let inScope = true;
            if (C.scope) {
                const a = scopeInScope(R, scopeCol, cellAt2(pRow, pM.idx.get(C.scope.column)));
                const b = scopeInScope(R, scopeCol, cellAt2(eRow, eM.idx.get(C.scope.column)));
                inScope = a || b;
                if (!inScope && C.scope.outOfScopePolicy === 'skip') continue;
            }
            // fuzzy-key row severity
            if (pair.status === 'fuzzyMatched') {
                emitTier('fuzzyKeyMatch', [{ row: pair.pr, field: null,
                    context: { matchKey: null, inScope, similarity: pair.similarity } }]);
                if (pair.ambiguous) emitTier('ambiguousFuzzyMatch', [{ row: pair.pr, field: null,
                    context: { inScope, similarity: pair.similarity } }]);
            }
            const rd = {
                matchKey: JSON.parse(buildKey(pRow, pM)), status: pair.status, inScope,
                similarity: pair.similarity, producedRow: pair.pr, expectedRow: pair.er, cells: {}, checkFails: [],
            };
            for (const col of comparedCols) {
                const pCell = cellAt2(pRow, pM.idx.get(col.name)), eCell = cellAt2(eRow, eM.idx.get(col.name));
                let ctxTol = null;
                const tolSpec = C.fields[col.name] && C.fields[col.name].tolerance;
                if (tolSpec != null) {
                    const eps = resolveTolerance(R, C, col, tolSpec, pRow, eRow, pM, eM, rd, functions,
                        { field: col.name, produced: pCell, expected: eCell });
                    if (isObj(eps) && eps.__err) {
                        rec.record(P_CELL, 'error', `customFunctionError:tolerance:${col.name}`,
                            [{ row: pair.pr, field: col.name, context: { fn: tolSpec.fn, errorMessage: eps.__err } }],
                            'customFunctionError');
                    } else if (isObj(eps) && eps.__contract) {
                        rec.record(P_CELL, 'error', `customFunctionContractViolation:tolerance:${col.name}`,
                            [{ row: pair.pr, field: col.name, context: { fn: tolSpec.fn, duplicateKey: 'tolerance<0/NaN' } }],
                            'customFunctionContractViolation');
                    } else ctxTol = { tol: tolSpec, eps };
                }
                const oc = cellOutcome(R, C, col, pCell, eCell, ctxTol);
                comparedCells++;
                if (oc.rollup === 'different') differentCells++;
                else if (oc.rollup === 'equivalent') equivalentCells++;
                rd.cells[col.name] = {
                    rollup: oc.rollup, tier: oc.tier, produced: pCell, expected: eCell,
                    producedInterpreted: oc.pi.k === 2 ? oc.pi.v : null,
                    expectedInterpreted: oc.ei.k === 2 ? oc.ei.v : null,
                    delta: oc.delta != null ? oc.delta : null,
                    tolerance: oc.tolerance != null ? oc.tolerance : null,
                    similarity: oc.similarity != null ? oc.similarity : null,
                };
                if (oc.tier !== 'exact') {
                    emitTier(oc.tier, [{
                        row: pair.pr, field: col.name, value: pCell,
                        context: {
                            matchKey: rd.matchKey, inScope, matchStatus: pair.status,
                            rollup: oc.rollup, tier: oc.tier, expected: eCell, produced: pCell,
                            delta: oc.delta != null ? oc.delta : undefined,
                            tolerance: oc.tolerance != null ? oc.tolerance : undefined,
                            similarity: oc.similarity != null ? oc.similarity : undefined,
                        },
                    }]);
                }
            }
            rowDiffs.push(rd);
        }

        // orphans
        const orphan = (rowIdx, side, table, map, tier) => {
            const row = table.rows[rowIdx];
            let inScope = true;
            if (C.scope) {
                inScope = scopeInScope(R, scopeCol, cellAt2(row, map.idx.get(C.scope.column)));
                if (!inScope && C.scope.outOfScopePolicy === 'skip') return;
            }
            const mk = JSON.parse(buildKey(row, map));
            rowDiffs.push({
                matchKey: mk, status: side === 'expected' ? 'missing' : 'unexpected', inScope,
                similarity: null, producedRow: side === 'produced' ? rowIdx : null,
                expectedRow: side === 'expected' ? rowIdx : null, cells: {}, checkFails: [],
            });
            emitTier(tier, [{ row: rowIdx, field: null, context: { matchKey: mk, inScope, side } }]);
        };
        for (const er of [...eUnpaired].sort((a, b) => a - b)) orphan(er, 'expected', expected, eM, 'rowMissing');
        for (const pr of [...pUnpaired].sort((a, b) => a - b)) orphan(pr, 'produced', produced, pM, 'rowUnexpected');

        // rows excluded by onDuplicateKey: "reportAndExclude" — never paired, never
        // orphaned; recorded in the diff with their own status so the fact layer stays
        // complete. Not compared, so they feed no cell counts and no check denominators.
        for (const ex of excluded) {
            const table = ex.side === 'produced' ? produced : expected;
            const map = ex.side === 'produced' ? pM : eM;
            const row = table.rows[ex.rowIdx];
            let inScope = true;
            if (C.scope) {
                inScope = scopeInScope(R, scopeCol, cellAt2(row, map.idx.get(C.scope.column)));
                if (!inScope && C.scope.outOfScopePolicy === 'skip') continue;
            }
            rowDiffs.push({
                matchKey: JSON.parse(buildKey(row, map)), status: 'excludedDuplicateKey', inScope,
                similarity: null, producedRow: ex.side === 'produced' ? ex.rowIdx : null,
                expectedRow: ex.side === 'expected' ? ex.rowIdx : null, cells: {}, checkFails: [],
            });
        }

        // diff summary
        const rowsMatched = pairs.length;
        const rowsMissing = eUnpaired.size, rowsUnexpected = pUnpaired.size;
        const orphanRateExpected = expected.rows.length ? rowsMissing / expected.rows.length : 0;
        const orphanRateProduced = produced.rows.length ? rowsUnexpected / produced.rows.length : 0;
        diff.rows = rowDiffs;
        diff.tableCheckFails = [];
        diff.summary = { comparedCells, differentCells, equivalentCells, orphanRateExpected, orphanRateProduced };

        // diff checks — row level
        for (const chk of C.diffChecks.row) {
            for (const rd of rowDiffs) {
                let res;
                try { res = functions[chk.fn](rd, chk.params); }
                catch (err) {
                    rec.record(P_CHK, 'error', `customFunctionError:${chk.name}`,
                        [{ row: rd.producedRow != null ? rd.producedRow : null, field: null,
                            context: { fn: chk.fn, errorMessage: String(err && err.message || err) } }],
                        'customFunctionError');
                }
                if (!Array.isArray(res)) continue;
                const seen = new Set();
                for (const item of res) {
                    if (!isObj(item) || typeof item.pass !== 'boolean') continue;
                    if (item.pass) continue;
                    const key = item.field == null ? ' ' : item.field;
                    if (seen.has(key)) {
                        rec.record(P_CHK, 'error', `customFunctionContractViolation:${chk.name}`,
                            [{ row: rd.producedRow, field: null, context: { fn: chk.fn, duplicateKey: key } }],
                            'customFunctionContractViolation');
                    }
                    seen.add(key);
                    rd.checkFails.push({ name: chk.name, field: item.field != null ? item.field : null, message: item.message != null ? item.message : null });
                    if (chk.severity !== 'none') {
                        rec.record(P_CHK, chk.severity, `customDiff:${chk.name}`, [{
                            row: rd.producedRow != null ? rd.producedRow : (rd.expectedRow != null ? rd.expectedRow : null),
                            field: item.field != null ? item.field : null,
                            context: { fn: chk.fn, level: 'row', userMessage: item.message != null ? item.message : null },
                        }]);
                    }
                }
            }
        }

        // diff checks — table level
        for (const chk of C.diffChecks.table) {
            if (chk.type === 'orphanRateMax') {
                const side = chk.params.side;
                const rate = side === 'produced' ? orphanRateProduced
                    : side === 'expected' ? orphanRateExpected
                        : Math.max(orphanRateExpected, orphanRateProduced);
                if (rate > chk.params.max) {
                    const fail = { name: chk.name, matchKey: null, field: null, message: `${side} orphan rate ${rate} exceeds ${chk.params.max}` };
                    diff.tableCheckFails.push(fail);
                    if (chk.severity !== 'none') rec.record(P_CHK, chk.severity, `orphanRateMax:${chk.name}`,
                        [{ row: null, field: null, context: { side, actualRate: rate, max: chk.params.max } }]);
                }
            } else if (chk.type === 'mismatchRateMax') {
                const rate = comparedCells ? differentCells / comparedCells : 0;
                if (rate > chk.params.max) {
                    diff.tableCheckFails.push({ name: chk.name, matchKey: null, field: null, message: `mismatch rate ${rate} exceeds ${chk.params.max}` });
                    if (chk.severity !== 'none') rec.record(P_CHK, chk.severity, `mismatchRateMax:${chk.name}`,
                        [{ row: null, field: null, context: { actualRate: rate, max: chk.params.max } }]);
                }
            } else {                                            // custom table
                let res;
                try { res = functions[chk.fn]({ rows: rowDiffs, summary: diff.summary }, chk.params); }
                catch (err) {
                    rec.record(P_CHK, 'error', `customFunctionError:${chk.name}`,
                        [{ row: null, field: null, context: { fn: chk.fn, errorMessage: String(err && err.message || err) } }],
                        'customFunctionError');
                }
                if (!Array.isArray(res)) continue;
                const seen = new Set();
                for (const item of res) {
                    if (!isObj(item) || typeof item.pass !== 'boolean' || item.pass) continue;
                    const key = (item.row != null ? item.row : ' ') + '|' + (item.field != null ? item.field : ' ');
                    if (seen.has(key)) {
                        rec.record(P_CHK, 'error', `customFunctionContractViolation:${chk.name}`,
                            [{ row: null, field: null, context: { fn: chk.fn, duplicateKey: key } }],
                            'customFunctionContractViolation');
                    }
                    seen.add(key);
                    diff.tableCheckFails.push({ name: chk.name, matchKey: item.row != null ? item.row : null, field: item.field != null ? item.field : null, message: item.message != null ? item.message : null });
                    if (chk.severity !== 'none') rec.record(P_CHK, chk.severity, `customDiff:${chk.name}`, [{
                        row: item.row != null ? item.row : null, field: item.field != null ? item.field : null,
                        context: { fn: chk.fn, level: 'table', userMessage: item.message != null ? item.message : null },
                    }]);
                }
            }
        }

        return {
            rowsProduced: produced.rows.length, rowsExpected: expected.rows.length,
            rowsMatched, rowsMissing, rowsUnexpected, rowsExcluded: excluded.length,
            columnsChecked: comparedCols.length,
        };
    }

    // ================================================================
    // compare() — the public comparison entry point (Core §15.1)
    // ================================================================

    function compare(schema, produced, expected, options) {
        if (!isObj(schema)) throw new TableValidationConfigError('schema must be a plain object');
        const checkTable = (t, name) => {
            if (!isObj(t)) throw new TableValidationConfigError(`${name} must be a TableInput object`);
            const h = t.headers === undefined ? null : t.headers;
            if (h !== null && !(Array.isArray(h) && h.every(isStr))) {
                throw new TableValidationConfigError(`${name}.headers must be an array of strings or null`);
            }
            if (!Array.isArray(t.rows) || t.rows.some((r) => !Array.isArray(r))) {
                throw new TableValidationConfigError(`${name}.rows must be an array of arrays`);
            }
        };
        checkTable(produced, 'produced');
        checkTable(expected, 'expected');
        const opts = options === undefined || options === null ? {} : options;
        if (!isObj(opts)) throw new TableValidationConfigError('options must be an object');
        const functions = opts.functions == null ? {} : opts.functions;
        if (!isObj(functions)) throw new TableValidationConfigError('options.functions must be an object');
        const refRaw = opts.referenceInstant === undefined ? null : opts.referenceInstant;
        if (refRaw !== null && !(refRaw instanceof Date) && !isStr(refRaw)) {
            throw new TableValidationConfigError('options.referenceInstant must be a Date, ISO 8601 string, or null');
        }
        if (schemaNeedsTemporal(schema)) { getLuxon(); makeReferenceInstant(refRaw); }

        const cfg = readConfigDefensively(schema);
        const rec = makeRecorder(cfg, makeRender(opts));
        const diff = { rows: [], tableCheckFails: [], summary: {} };
        let meta = { rowsProduced: 0, rowsExpected: 0, rowsMatched: 0, rowsMissing: 0, rowsUnexpected: 0, rowsExcluded: 0, columnsChecked: 0 };

        try {
            try {
                validateSchemaPhase1(schema, functions);
                validateComparisonConfig(schema, functions);
            } catch (e) {
                if (e && e.__tvSchemaFail) {
                    rec.record('schemaValidation', 'error', 'schemaValidationError',
                        [{ row: null, field: '_schema', context: e.__tvSchemaFail }], 'schemaInvalid');
                }
                throw e;
            }
            const R = resolveSchema(schema, rec);
            runtimeResolve(R, refRaw);
            meta = runComparison(R, resolveComparison(schema), produced, expected, rec, cfg, functions, diff);
        } catch (sig) {
            if (sig !== ABORT && sig !== STOP) throw sig;
        }

        return rec.finalize({
            rowsChecked: diff.rows.length,
            columnsChecked: meta.columnsChecked,
            summaryExtra: {
                rowsProduced: meta.rowsProduced, rowsExpected: meta.rowsExpected,
                rowsMatched: meta.rowsMatched, rowsMissing: meta.rowsMissing, rowsUnexpected: meta.rowsUnexpected,
                rowsExcluded: meta.rowsExcluded,
            },
            extra: { engine: 'compare', diff },
        });
    }

    // ================================================================
    // exportComparisonXlsx (Core §15.11) — Comparison / Errors / Data sheets
    // ================================================================

    const cmpCellText = (cd) => {
        if (cd.rollup === 'equal') return cd.produced === null ? null : cd.produced;
        const tag = cd.rollup === 'equivalent' ? '⚠' : '✖';
        const op = cd.rollup === 'equivalent' ? '≈' : '≠';
        return `${tag} ${canonical(cd.produced)} ${op} ${canonical(cd.expected)}`;
    };

    async function exportComparisonXlsx(args) {
        const ExcelJS = global.ExcelJS;
        if (!ExcelJS) {
            throw new TableValidationConfigError(
                'The ExcelJS global is required by exportComparisonXlsx but is not loaded.');
        }
        if (!isObj(args) || !isObj(args.result) || !isObj(args.result.diff) || !isObj(args.schema)) {
            throw new TableValidationConfigError('exportComparisonXlsx expects { result, table, schema, expected }');
        }
        const { result, schema } = args;
        const msgOf = exportMsgOf(args);
        const diff = result.diff;
        let sevMap = DEFAULT_CMP_SEV;
        try { sevMap = resolveComparison(schema).sev; } catch (_) { /* keep defaults */ }

        // compared column order (schema order, only fields appearing in the diff)
        const present = new Set();
        for (const rd of diff.rows) for (const k of Object.keys(rd.cells)) present.add(k);
        const cols = Object.keys(schema.columns).filter((n) => present.has(n));

        const wb = new ExcelJS.Workbook();
        const wsCmp = wb.addWorksheet('Comparison');
        const wsErr = wb.addWorksheet('Errors');
        const wsData = wb.addWorksheet('Data');

        // Comparison sheet
        wsCmp.addRow(['Match Status', 'Scope', ...cols]);
        for (const rd of diff.rows) {
            const row = wsCmp.addRow([
                rd.status, rd.inScope ? 'in' : 'out',
                ...cols.map((c) => (rd.cells[c] ? cmpCellText(rd.cells[c]) : null)),
            ]);
            cols.forEach((c, i) => {
                const cd = rd.cells[c];
                if (!cd) return;
                const sev = sevMap[cd.tier];
                if (sev === 'error' || sev === 'warning') styleCell(row.getCell(i + 3), sev);
            });
            if (rd.status === 'missing' || rd.status === 'unexpected') {
                const sev = sevMap[rd.status === 'missing' ? 'rowMissing' : 'rowUnexpected'];
                if (sev === 'error' || sev === 'warning') styleCell(row.getCell(1), sev);
            }
        }
        finishSheet(wsCmp, cols.length + 2, diff.rows.length + 1);

        // Errors sheet (from register, with Scope + Match Status)
        wsErr.addRow(['#', 'Severity', 'Check', 'Column', 'Row', 'Message', 'Scope', 'Match Status']);
        const reg = Array.isArray(result.cellRegister) ? result.cellRegister : [];
        const sorted = reg.slice().sort((a, b) =>
            SEV_RANK[a.severity] - SEV_RANK[b.severity] || ((a.row == null ? -1 : a.row) - (b.row == null ? -1 : b.row)));
        sorted.forEach((e, i) => {
            const row = wsErr.addRow([
                i + 1, e.severity.toUpperCase(), e.ruleName,
                e.field != null ? e.field : '—', e.row != null ? e.row + 1 : '—',
                msgOf(e),
                e.context && e.context.inScope === false ? 'out' : (e.context && e.context.inScope === true ? 'in' : '—'),
                e.context && e.context.matchStatus ? e.context.matchStatus : '—',
            ]);
            styleCell(row.getCell(2), e.severity);
        });
        finishSheet(wsErr, 8, sorted.length + 1);

        // Data sheet — the raw produced (hyperlink target rows) and expected tables (JS spec §3.7).
        // `table` is the spec argument name; `produced` stays accepted as a legacy alias.
        const produced = args.table || args.produced || { headers: null, rows: [] };
        const pHeaders = Array.isArray(produced.headers) ? produced.headers : cols;
        wsData.addRow(pHeaders);
        for (const r of produced.rows) wsData.addRow(r.map((v) => (v === null ? null : v)));
        let dataRows = produced.rows.length + 1;
        const expected = args.expected;
        if (isObj(expected) && Array.isArray(expected.rows)) {
            wsData.addRow([]);
            wsData.addRow(['— expected —']);
            const eHeaders = Array.isArray(expected.headers) ? expected.headers : cols;
            wsData.addRow(eHeaders);
            for (const r of expected.rows) wsData.addRow(r.map((v) => (v === null ? null : v)));
            dataRows += 3 + expected.rows.length;
        }
        finishSheet(wsData, pHeaders.length, dataRows);

        const buffer = await wb.xlsx.writeBuffer();
        return new Blob([buffer], { type: XLSX_MIME });
    }

    // ================================================================
    // Addendum §A — Config meta-model (§A.1–§A.3, JS spec §3.11)
    // ================================================================

    // Predicate / dependency shorthands (Addendum §A.2 grammar)
    const EQp = (path, value) => ({ path, op: 'eq', value });
    const INp = (path, value) => ({ path, op: 'in', value });
    const NIp = (path, value) => ({ path, op: 'notIn', value });
    const NNp = (path) => ({ path, op: 'nonNull' });
    const ALLp = (...ps) => ({ all: ps });
    const REQd = (predicate) => ({ kind: 'requires', predicate, group: null });
    const XORd = (group) => ({ kind: 'exactlyOneOf', predicate: null, group });
    const RWd = (group) => ({ kind: 'requiredWith', predicate: null, group });

    const REL_BYNAME = EQp('structure.columnMatching', 'byName');
    const REL_NONSTRICT = EQp('columns.<name>.evaluation.strictType#effective', false);
    const REL_FUZZY = NNp('comparison.match.fuzzy');
    const REL_SCOPE = NNp('comparison.scope');

    const DEF_SMS_LOOSE = { caseSensitive: false, trim: true, stripSpaces: false };
    const DEF_SMS_STRICT = { caseSensitive: true, trim: false, stripSpaces: false };

    // SettingDescriptor constructor (Addendum §A.1). `def` omitted ⇒ required setting.
    function S(path, section, type, o) {
        o = o || {};
        const d = {
            path, section, type,
            required: o.req === true,
            enum: o.en !== undefined ? o.en : null,
            engines: o.eng !== undefined ? o.eng : ['validate', 'compare'],
            dependsOn: o.dep !== undefined ? o.dep : [],
            relevantWhen: o.rel !== undefined ? o.rel : null,
            metaRules: o.mr !== undefined ? o.mr : [],
            doc: { label: o.lbl !== undefined ? o.lbl : path.split('.').pop().replace(/\[\]$/, ''), description: o.d },
        };
        if (o.req !== true) d.default = o.def !== undefined ? o.def : null;
        return d;
    }

    const VONLY = ['validate'];
    const CONLY = ['compare'];
    const SEV_EN = ['error', 'warning'];
    const TIER_SEV_EN = ['none', 'warning', 'error'];

    const configModel = {
        specVersion: SPEC_VERSION,
        settings: [
            // ---- meta (§11.1)
            S('meta.schemaVersion', 'meta', 'string', { req: true, mr: ['10:1'], d: 'Schema format version (semver), for compatibility checking.' }),
            S('meta.name', 'meta', 'string', { req: true, mr: ['10:1'], d: 'Human-readable schema name, used in results and logs.' }),
            S('meta.description', 'meta', 'string', { def: '', d: 'Optional description of the schema purpose.' }),
            // ---- resultConfig (§11.2)
            S('resultConfig.maxSamples', 'resultConfig', 'int', { def: 5, mr: ['10:49'], d: 'Max sample values / rows per grouped detail.' }),
            S('resultConfig.maxErrors', 'resultConfig', 'int|null', { def: null, mr: ['10:50'], d: 'Global circuit breaker on error violations; null = no limit.' }),
            S('resultConfig.maxErrorsPerColumn', 'resultConfig', 'int|null', { def: null, eng: VONLY, mr: ['10:51'], d: 'Per-column breaker (Phase 6); null = no limit. compare() ignores it.' }),
            S('resultConfig.collectCellRegister', 'resultConfig', 'bool', { def: false, d: 'Retain the per-entry violation register (required by the XLSX export).' }),
            S('resultConfig.collectCellObservations', 'resultConfig', 'bool', { def: false, eng: VONLY, mr: ['10:56'], d: 'Emit the dense per-cell observation channel (required by the annotated export).' }),
            S('resultConfig.stopPolicy', 'resultConfig', 'enum', { def: 'never', en: ['never', 'firstError'], mr: ['10:56'], d: 'Fail-fast policy: "firstError" aborts on the first error violation.' }),
            // ---- nullHandling (§11.3)
            S('nullHandling.nullEquivalents', 'nullHandling', 'string[]', { def: [], mr: ['10:2'], d: 'Strings that count as null (exact match); recognition only.' }),
            // ---- evaluation (§11.4)
            S('evaluation.strictType', 'evaluation', 'bool', { def: true, mr: ['10:3'], d: 'true → natively typed values required; false → interpretable strings accepted.' }),
            S('evaluation.timezone', 'evaluation', 'string', { def: 'utc', mr: ['10:4'], d: '"utc", "local", or an IANA zone; governs all temporal semantics.' }),
            // ---- structure (§11.5)
            S('structure.columnMatching', 'structure', 'enum', { def: 'byName', en: ['byName', 'byPosition'], mr: ['10:6'], d: 'How schema columns map to table columns.' }),
            S('structure.fieldNameMatching', 'structure', 'StringMatchStrategy', { def: DEF_SMS_LOOSE, rel: REL_BYNAME, mr: ['10:10', '10:41'], d: 'Header ↔ schema-name matching (byName only).' }),
            S('structure.rowCount', 'structure', 'Range', { def: DEF_RANGE, mr: ['10:13', '10:14'], d: 'Allowed row-count range.' }),
            S('structure.columnCount', 'structure', 'Range', { def: DEF_RANGE, mr: ['10:13', '10:14'], d: 'Allowed column-count range.' }),
            S('structure.allowDuplicateRows', 'structure', 'bool', { def: true, d: 'false → duplicate rows are violations.' }),
            S('structure.allowAllNullRows', 'structure', 'bool', { def: true, d: 'false → all-null rows are violations.' }),
            S('structure.allowDuplicateColumns', 'structure', 'bool', { def: true, d: 'false → identical column content is a violation.' }),
            S('structure.allowAllNullColumns', 'structure', 'bool', { def: true, d: 'false → all-null columns are violations.' }),
            S('structure.duplicateColumnNames.strategy', 'structure', 'enum', { def: 'halt', en: ['rename', 'halt', 'keepFirst'], rel: REL_BYNAME, d: 'Duplicate-header handling (byName only).' }),
            S('structure.duplicateColumnNames.renamePattern', 'structure', 'string', { def: '{name}~{index}', rel: ALLp(REL_BYNAME, EQp('structure.duplicateColumnNames.strategy', 'rename')), mr: ['10:44'], d: 'Mapping-name pattern for strategy "rename".' }),
            S('structure.allowExtraColumns', 'structure', 'bool', { def: false, d: 'false → unmatched/trailing table columns are violations.' }),
            S('structure.allowMissingColumns', 'structure', 'bool', { def: false, d: 'false → absent schema columns are violations (via derived required).' }),
            S('structure.enforceColumnOrder', 'structure', 'bool', { def: false, rel: REL_BYNAME, d: 'true (byName) → schema columns must appear in declared order.' }),
            S('structure.duplicateDetection.matchStrategy', 'structure', 'StringMatchStrategy', { def: DEF_SMS_STRICT, mr: ['10:10'], d: 'String comparison for duplicates, uniqueness, composite keys.' }),
            S('structure.severities.<rule>', 'structure', 'enum', { def: 'error', en: SEV_EN, mr: ['10:55'], d: 'Per-rule severity for column-unbound structural rules (duplicateColumnName defaults "warning").' }),
            // ---- columns (§11.6)
            S('columns.<name>.required', 'columns', 'bool|null', { def: null, mr: ['10:7', '10:42'], d: 'null → effective value is NOT structure.allowMissingColumns.' }),
            S('columns.<name>.nullable', 'columns', 'bool', { def: false, d: 'Whether cells may be effectively null.' }),
            S('columns.<name>.severity', 'columns', 'Severity', { def: 'error', mr: ['10:53'], d: 'Governing severity for this column ("error"/"warning" or {default, byRule}).' }),
            S('columns.<name>.stopOnFail', 'columns', 'bool', { def: false, eng: VONLY, mr: ['10:54'], d: 'true → any violation on this column aborts the run.' }),
            S('columns.<name>.unique.enabled', 'columns', 'bool', { def: false, d: 'true → non-null values must be unique.' }),
            S('columns.<name>.unique.nullsEqual', 'columns', 'bool', { def: false, rel: ALLp(EQp('columns.<name>.nullable', true), EQp('columns.<name>.unique.enabled', true)), d: 'true → effective nulls participate (at most one allowed).' }),
            S('columns.<name>.nullHandling.nullEquivalents', 'columns', 'string[]|null', { def: null, mr: ['10:25'], d: 'Column-level null list; null inherits the table level.' }),
            S('columns.<name>.evaluation.strictType', 'columns', 'bool|null', { def: null, rel: NIp('columns.<name>.type.name', ['datetime', 'date', 'time', 'categorical', 'skip']), mr: ['10:25'], d: 'Column-level strict-typing override; null inherits.' }),
            S('columns.<name>.type.name', 'columns', 'enum', { req: true, en: TYPE_NAMES.slice(), mr: ['10:18', '10:19'], d: 'Declared column data type.' }),
            // ---- type blocks (§11.7)
            S('columns.<name>.type.length', 'type:string', 'Range|null', { def: null, mr: ['10:14'], d: 'Allowed character-count range (code points).' }),
            S('columns.<name>.type.regex', 'type:string', 'string|null', { def: null, mr: ['10:47'], d: 'Pattern string values must match (ECMAScript dialect).' }),
            S('columns.<name>.type.regexFlags', 'type:string', 'string|null', { def: null, dep: [REQd(NNp('columns.<name>.type.regex'))], mr: ['10:24'], d: 'Flags for regex (subset of "imsu").' }),
            S('columns.<name>.type.formats', 'type:int', 'NumberFormat[]|null', { def: null, rel: REL_NONSTRICT, mr: ['10:12', '10:26'], d: 'Numeric string acceptance formats, tried in order.' }),
            S('columns.<name>.type.value', 'type:int', 'Range|null', { def: null, mr: ['10:15', '10:52'], d: 'Allowed integer range (safe-range integral bounds).' }),
            S('columns.<name>.type.formats', 'type:float', 'NumberFormat[]|null', { def: null, rel: REL_NONSTRICT, mr: ['10:12'], d: 'Numeric string acceptance formats, tried in order.' }),
            S('columns.<name>.type.value', 'type:float', 'Range|null', { def: null, mr: ['10:15'], d: 'Allowed float range.' }),
            S('columns.<name>.type.precision', 'type:float', 'Range|null', { def: null, mr: ['10:14'], d: 'Allowed decimal-digit-count range (value as given).' }),
            S('columns.<name>.type.trueValues', 'type:bool', 'string[]', { def: ['true', '1', 'yes'], rel: REL_NONSTRICT, mr: ['10:22', '10:43'], d: 'Strings that count as true.' }),
            S('columns.<name>.type.falseValues', 'type:bool', 'string[]', { def: ['false', '0', 'no'], rel: REL_NONSTRICT, mr: ['10:22', '10:43'], d: 'Strings that count as false.' }),
            S('columns.<name>.type.matchStrategy', 'type:bool', 'StringMatchStrategy', { def: DEF_SMS_LOOSE, rel: REL_NONSTRICT, mr: ['10:10'], d: 'Comparison of cell strings to the value lists.' }),
            S('columns.<name>.type.formats', 'type:datetime', 'string[]', { req: true, mr: ['10:20', '10:21', '10:48'], d: 'Datetime acceptance formats (full datetime components).' }),
            S('columns.<name>.type.value', 'type:datetime', 'Range|null', { def: null, mr: ['10:16'], d: 'Allowed datetime range (ISO strings or T+/-N).' }),
            S('columns.<name>.type.formats', 'type:date', 'string[]', { req: true, mr: ['10:20', '10:21', '10:48'], d: 'Date acceptance formats (no time tokens).' }),
            S('columns.<name>.type.value', 'type:date', 'Range|null', { def: null, mr: ['10:16'], d: 'Allowed date range (ISO strings or T+/-N).' }),
            S('columns.<name>.type.formats', 'type:time', 'string[]', { req: true, mr: ['10:20', '10:21', '10:48'], d: 'Time acceptance formats (no date tokens).' }),
            S('columns.<name>.type.value', 'type:time', 'Range|null', { def: null, mr: ['10:17'], d: 'Allowed time range (static times; no T+/-N; no midnight wrap).' }),
            S('columns.<name>.type.allowedValues', 'type:categorical', 'any[]', { req: true, mr: ['10:23'], d: 'The allowed value set; membership is the type check.' }),
            S('columns.<name>.type.typeStrict', 'type:categorical', 'bool', { def: false, d: 'true → JSON-type match + strict equality; false → canonical strings.' }),
            S('columns.<name>.type.matchStrategy', 'type:categorical', 'StringMatchStrategy', { def: DEF_SMS_LOOSE, mr: ['10:10'], d: 'String comparison against allowed values.' }),
            // ---- compositeKeys (§11.8)
            S('compositeKeys[].columns', 'compositeKeys', 'string[]', { req: true, mr: ['10:27', '10:31', '10:46'], d: 'Key columns (≥ 2, all existing); tuples compared element-wise.' }),
            S('compositeKeys[].nullsAllowed', 'compositeKeys', 'bool', { def: false, d: 'false → effective null in a key cell is a violation.' }),
            S('compositeKeys[].severity', 'compositeKeys', 'enum', { def: 'error', en: SEV_EN, d: 'Governing severity for this key.' }),
            // ---- customRowChecks (§11.9, §7.1)
            S('customRowChecks[].name', 'customRowChecks', 'string', { req: true, d: 'Rule-name suffix (e.g. "comparison:<name>").' }),
            S('customRowChecks[].type', 'customRowChecks', 'enum', { req: true, en: ['comparison', 'conditionalRequired', 'nonNullCount', 'cooccurrence', 'custom'], d: 'Row-check kind; determines type-specific parameters.' }),
            S('customRowChecks[].severity', 'customRowChecks', 'enum', { def: 'error', en: SEV_EN, d: 'Governing severity for this check.' }),
            S('customRowChecks[].fieldA', 'customRowChecks', 'string', { dep: [REQd(EQp('customRowChecks[].type', 'comparison'))], mr: ['10:28', '10:34'], d: 'Left operand column of a comparison check.' }),
            S('customRowChecks[].fieldB', 'customRowChecks', 'string', { dep: [REQd(EQp('customRowChecks[].type', 'comparison'))], mr: ['10:28', '10:34'], d: 'Right operand column of a comparison check.' }),
            S('customRowChecks[].op', 'customRowChecks', 'enum', { en: COMP_OPS.slice(), dep: [REQd(EQp('customRowChecks[].type', 'comparison'))], d: 'Comparison operator.' }),
            S('customRowChecks[].if', 'customRowChecks', 'object', { dep: [REQd(EQp('customRowChecks[].type', 'conditionalRequired'))], mr: ['10:35'], d: 'Condition { field, op, value } of a conditionalRequired check.' }),
            S('customRowChecks[].then', 'customRowChecks', 'object', { dep: [REQd(EQp('customRowChecks[].type', 'conditionalRequired'))], mr: ['10:35'], d: 'Consequence { field, nonNull: true } of a conditionalRequired check.' }),
            S('customRowChecks[].fields', 'customRowChecks', 'string[]', { dep: [REQd(INp('customRowChecks[].type', ['nonNullCount', 'cooccurrence']))], mr: ['10:28', '10:32'], d: 'Field list (≥ 2) for nonNullCount/cooccurrence.' }),
            S('customRowChecks[].expected', 'customRowChecks', 'int', { dep: [REQd(EQp('customRowChecks[].type', 'nonNullCount'))], mr: ['10:33'], d: 'Exact non-null count expected.' }),
            S('customRowChecks[].fn', 'customRowChecks', 'string', { dep: [REQd(EQp('customRowChecks[].type', 'custom'))], mr: ['10:30'], d: 'Registered custom function name.' }),
            S('customRowChecks[].params', 'customRowChecks', 'object|null', { def: null, dep: [REQd(EQp('customRowChecks[].type', 'custom'))], d: 'Params object passed to the custom function.' }),
            // ---- customTableChecks (§11.10, §7.2)
            S('customTableChecks[].name', 'customTableChecks', 'string', { req: true, d: 'Rule-name suffix (e.g. "monotonic:<name>").' }),
            S('customTableChecks[].type', 'customTableChecks', 'enum', { req: true, en: ['monotonic', 'sequenceNoGaps', 'sumEquals', 'custom'], d: 'Table-check kind; determines type-specific parameters.' }),
            S('customTableChecks[].severity', 'customTableChecks', 'enum', { def: 'error', en: SEV_EN, d: 'Governing severity for this check.' }),
            S('customTableChecks[].field', 'customTableChecks', 'string', { dep: [REQd(INp('customTableChecks[].type', ['monotonic', 'sequenceNoGaps']))], mr: ['10:29', '10:38', '10:40'], d: 'Checked column for monotonic/sequenceNoGaps.' }),
            S('customTableChecks[].direction', 'customTableChecks', 'enum', { en: ['increasing', 'decreasing', 'nonDecreasing', 'nonIncreasing'], dep: [REQd(EQp('customTableChecks[].type', 'monotonic'))], d: 'Required monotonic order.' }),
            S('customTableChecks[].start', 'customTableChecks', 'int|null', { def: null, dep: [REQd(EQp('customTableChecks[].type', 'sequenceNoGaps'))], d: 'Expected sequence start; null → inferred minimum.' }),
            S('customTableChecks[].fields', 'customTableChecks', 'string[]', { dep: [REQd(EQp('customTableChecks[].type', 'sumEquals'))], mr: ['10:29', '10:39'], d: 'Summed columns (int/float).' }),
            S('customTableChecks[].expectedValue', 'customTableChecks', 'number|null', { def: null, dep: [REQd(EQp('customTableChecks[].type', 'sumEquals')), XORd(['customTableChecks[].expectedValue', 'customTableChecks[].expectedField'])], mr: ['10:36'], d: 'Literal expected sum.' }),
            S('customTableChecks[].expectedField', 'customTableChecks', 'string|null', { def: null, dep: [REQd(EQp('customTableChecks[].type', 'sumEquals')), XORd(['customTableChecks[].expectedValue', 'customTableChecks[].expectedField']), RWd(['customTableChecks[].expectedFieldRow'])], mr: ['10:29', '10:36', '10:37'], d: 'Column holding the expected sum.' }),
            S('customTableChecks[].expectedFieldRow', 'customTableChecks', '"first"|"last"|int', { dep: [REQd(NNp('customTableChecks[].expectedField'))], mr: ['10:37'], d: 'Row supplying the expected value when expectedField is used.' }),
            S('customTableChecks[].tolerance', 'customTableChecks', 'number', { def: 0, dep: [REQd(EQp('customTableChecks[].type', 'sumEquals'))], mr: ['10:39'], d: 'Allowed |actual − expected| for sumEquals.' }),
            S('customTableChecks[].fn', 'customTableChecks', 'string', { dep: [REQd(EQp('customTableChecks[].type', 'custom'))], mr: ['10:30'], d: 'Registered custom function name.' }),
            S('customTableChecks[].params', 'customTableChecks', 'object|null', { def: null, dep: [REQd(EQp('customTableChecks[].type', 'custom'))], d: 'Params object passed to the custom function.' }),
            // ---- comparison (§15.3, §15.12) — compare() only
            S('comparison.match.keys', 'comparison', 'string[]', { req: true, eng: CONLY, mr: ['C1'], d: 'Composite match key: ≥ 1 existing column names.' }),
            S('comparison.match.setMode', 'comparison', 'enum', { def: 'exact', en: ['exact', 'superset', 'subset'], eng: CONLY, mr: ['C2'], d: 'Row-set relation; drives orphan-tier default severities.' }),
            S('comparison.match.onDuplicateKey', 'comparison', 'enum', { def: 'abort', en: ['abort', 'reportAndExclude'], eng: CONLY, mr: ['C2'], d: 'Duplicate interpreted match key: abort the run, or report one duplicateMatchKey violation per key group and exclude its rows from pairing.' }),
            S('comparison.match.fuzzy', 'comparison', 'FuzzyKeySpec|null', { def: null, eng: CONLY, mr: ['C3'], d: 'Fuzzy key pairing over the exact-match residue; null → exact only.' }),
            S('comparison.match.fuzzy.components', 'comparison', 'string[]', { eng: CONLY, dep: [REQd(REL_FUZZY)], mr: ['C3'], d: 'Key columns compared fuzzily (required with fuzzy).' }),
            S('comparison.match.fuzzy.threshold', 'comparison', 'number|map', { eng: CONLY, dep: [REQd(REL_FUZZY)], mr: ['C3'], d: 'Similarity threshold in (0,1] or per-component map — no default.' }),
            S('comparison.match.fuzzy.metric', 'comparison', 'enum', { def: 'tokenizedFuzzy', en: ['tokenizedFuzzy', 'jaroWinkler', 'levenshtein'], eng: CONLY, rel: REL_FUZZY, mr: ['C3'], d: 'String-similarity metric.' }),
            S('comparison.match.fuzzy.ambiguityMargin', 'comparison', 'number', { def: 0, eng: CONLY, rel: REL_FUZZY, mr: ['C3'], d: 'Runner-up within this of the winner → ambiguousFuzzyMatch.' }),
            S('comparison.match.fuzzy.maxCandidatePairs', 'comparison', 'int', { def: 1000000, eng: CONLY, rel: REL_FUZZY, mr: ['C3'], d: 'Fuzzy pairing cost guardrail; exceeding aborts.' }),
            S('comparison.fields.<col>.compare', 'comparison', 'bool', { def: true, eng: CONLY, mr: ['C4'], d: 'false → interpreted/keyable but not cell-compared.' }),
            S('comparison.fields.<col>.presence', 'comparison', 'enum', { def: 'both', en: ['both', 'producedOnly', 'expectedOnly'], eng: CONLY, mr: ['C4'], d: 'Declares a technical one-sided column.' }),
            S('comparison.fields.<col>.expectedName', 'comparison', 'string|null', { def: null, eng: CONLY, rel: { path: 'structure.columnMatching', op: 'eq', value: 'byName' }, mr: ['C4'], d: 'Header the EXPECTED table carries this column under; results and diff keep the logical name.' }),
            S('comparison.fields.<col>.tolerance', 'comparison', 'ToleranceSpec|null', { def: null, eng: CONLY, dep: [REQd(INp('columns.<col>.type.name', ['int', 'float']))], mr: ['C4', 'C5'], d: 'Numeric tolerance (absolute, per-row field, relative, or custom fn).' }),
            S('comparison.fields.<col>.fuzzy', 'comparison', 'CellFuzzySpec|null', { def: null, eng: CONLY, dep: [REQd(EQp('columns.<col>.type.name', 'string'))], mr: ['C4'], d: 'Cell-level fuzzy matching for a string column.' }),
            S('comparison.severity.toleranceMatch', 'comparison', 'enum', { def: 'none', en: TIER_SEV_EN, eng: CONLY, mr: ['C6'], d: 'Severity of the toleranceMatch tier.' }),
            S('comparison.severity.interpretedMatch', 'comparison', 'enum', { def: 'warning', en: TIER_SEV_EN, eng: CONLY, mr: ['C6'], d: 'Severity of the interpretedMatch tier.' }),
            S('comparison.severity.fuzzyMatch', 'comparison', 'enum', { def: 'warning', en: TIER_SEV_EN, eng: CONLY, mr: ['C6'], d: 'Severity of the fuzzyMatch tier.' }),
            S('comparison.severity.crossTypeMismatch', 'comparison', 'enum', { def: 'error', en: TIER_SEV_EN, eng: CONLY, mr: ['C6'], d: 'Severity of the crossTypeMismatch tier.' }),
            S('comparison.severity.valueMismatch', 'comparison', 'enum', { def: 'error', en: TIER_SEV_EN, eng: CONLY, mr: ['C6'], d: 'Severity of the valueMismatch tier.' }),
            S('comparison.severity.fuzzyKeyMatch', 'comparison', 'enum', { def: 'warning', en: TIER_SEV_EN, eng: CONLY, mr: ['C6'], d: 'Severity of the fuzzyKeyMatch tier.' }),
            S('comparison.severity.ambiguousFuzzyMatch', 'comparison', 'enum', { def: 'warning', en: TIER_SEV_EN, eng: CONLY, mr: ['C6'], d: 'Severity of the ambiguousFuzzyMatch tier.' }),
            S('comparison.severity.rowMissing', 'comparison', 'enum', { def: 'error', en: TIER_SEV_EN, eng: CONLY, mr: ['C6'], d: 'Severity of rowMissing; default derives from setMode (superset → none).' }),
            S('comparison.severity.rowUnexpected', 'comparison', 'enum', { def: 'error', en: TIER_SEV_EN, eng: CONLY, mr: ['C6'], d: 'Severity of rowUnexpected; default derives from setMode (subset → none).' }),
            S('comparison.severity.columnOnlyOnOneSide', 'comparison', 'enum', { def: 'error', en: TIER_SEV_EN, eng: CONLY, mr: ['C6'], d: 'Severity of columnOnlyOnOneSide.' }),
            S('comparison.severity.duplicateMatchKey', 'comparison', 'enum', { def: 'error', en: TIER_SEV_EN, eng: CONLY, rel: { path: 'comparison.match.onDuplicateKey', op: 'eq', value: 'reportAndExclude' }, mr: ['C6'], d: 'Severity of a duplicated key group under onDuplicateKey: "reportAndExclude" (the abort policy is not severity-mappable).' }),
            S('comparison.scope', 'comparison', 'object|null', { def: null, eng: CONLY, mr: ['C7'], d: 'Scope filter indicator (never a severity lever); null → all rows in scope.' }),
            S('comparison.scope.column', 'comparison', 'string', { eng: CONLY, dep: [REQd(REL_SCOPE)], mr: ['C7'], d: 'Column whose value determines scope membership.' }),
            S('comparison.scope.inScopeValues', 'comparison', 'any[]', { eng: CONLY, dep: [REQd(REL_SCOPE), XORd(['comparison.scope.inScopeValues', 'comparison.scope.outOfScopeValues'])], mr: ['C7'], d: 'Values marking a row in scope.' }),
            S('comparison.scope.outOfScopeValues', 'comparison', 'any[]', { eng: CONLY, dep: [REQd(REL_SCOPE), XORd(['comparison.scope.inScopeValues', 'comparison.scope.outOfScopeValues'])], mr: ['C7'], d: 'Values marking a row out of scope.' }),
            S('comparison.scope.matchStrategy', 'comparison', 'StringMatchStrategy', { def: DEF_SMS_LOOSE, eng: CONLY, rel: REL_SCOPE, mr: ['C7'], d: 'String comparison for scope membership.' }),
            S('comparison.scope.outOfScopePolicy', 'comparison', 'enum', { def: 'compare', en: ['compare', 'skip'], eng: CONLY, rel: REL_SCOPE, mr: ['C7'], d: '"compare" tags out-of-scope rows; "skip" excludes them entirely.' }),
            S('comparison.diffChecks.row[].name', 'comparison', 'string', { req: true, eng: CONLY, mr: ['C8'], d: 'Row diff-check rule-name suffix.' }),
            S('comparison.diffChecks.row[].type', 'comparison', 'enum', { req: true, en: ['custom'], eng: CONLY, mr: ['C8'], d: 'Row-level diff checks are custom only.' }),
            S('comparison.diffChecks.row[].severity', 'comparison', 'enum', { def: 'error', en: TIER_SEV_EN, eng: CONLY, mr: ['C8'], d: 'Severity of this diff check.' }),
            S('comparison.diffChecks.row[].fn', 'comparison', 'string', { eng: CONLY, dep: [REQd(EQp('comparison.diffChecks.row[].type', 'custom'))], mr: ['C8'], d: 'Registered diff-check function.' }),
            S('comparison.diffChecks.row[].params', 'comparison', 'object|null', { def: null, eng: CONLY, d: 'Params object passed to the check.' }),
            S('comparison.diffChecks.table[].name', 'comparison', 'string', { req: true, eng: CONLY, mr: ['C8'], d: 'Table diff-check rule-name suffix.' }),
            S('comparison.diffChecks.table[].type', 'comparison', 'enum', { req: true, en: ['custom', 'orphanRateMax', 'mismatchRateMax'], eng: CONLY, mr: ['C8'], d: 'Table diff-check kind.' }),
            S('comparison.diffChecks.table[].severity', 'comparison', 'enum', { def: 'error', en: TIER_SEV_EN, eng: CONLY, mr: ['C8'], d: 'Severity of this diff check.' }),
            S('comparison.diffChecks.table[].fn', 'comparison', 'string', { eng: CONLY, dep: [REQd(EQp('comparison.diffChecks.table[].type', 'custom'))], mr: ['C8'], d: 'Registered diff-check function (custom type).' }),
            S('comparison.diffChecks.table[].params', 'comparison', 'object|null', { def: null, eng: CONLY, mr: ['C8'], d: 'Built-in params ({max, side} / {max}) or custom params.' }),
        ],
        crossRules: [
            { rule: '10:41', doc: 'byName: schema column names must not collide after fieldNameMatching.' },
            { rule: '10:42', doc: 'byPosition: effective-optional columns must form a contiguous trailing suffix.' },
            { rule: '10:43', doc: 'Bool trueValues and falseValues must not overlap after matchStrategy.' },
            { rule: '10:45', doc: 'Per-column required: true overrides allowMissingColumns (valid configuration).' },
            { rule: '10:46', doc: 'Composite key column groups must not duplicate each other.' },
            { rule: '10:47', doc: 'Regex patterns must compile in the normative dialect with declared flags.' },
            { rule: '10:48', doc: 'Temporal format strings must be valid for the profile temporal engine.' },
            { rule: 'C1', doc: 'A comparison section (with match.keys) is required whenever compare() is invoked.' },
        ],
    };

    (function freezeDeep(o) {
        Object.freeze(o);
        for (const k of Object.keys(o)) {
            const v = o[k];
            if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) freezeDeep(v);
        }
    })(configModel);

    // ================================================================
    // Addendum §A — Config builder (§A.4–§A.6, JS spec §3.11)
    // ================================================================

    // Generic-path registry from the descriptor set (rule M8)
    const MODEL_PATHS = new Set(configModel.settings.map((s) => s.path));

    function parseSettingPath(path) {
        if (!isStr(path) || path.length === 0) {
            throw new TableValidationConfigError('setting path must be a non-empty string');
        }
        const segs = [];
        for (const raw of path.split('.')) {
            const m = /^([^[\]]+)(\[(\d+)\])?$/.exec(raw);
            if (!m) throw new TableValidationConfigError(`invalid path segment "${raw}" in "${path}"`);
            segs.push({ key: m[1], idx: m[3] !== undefined ? +m[3] : null });
        }
        return segs;
    }

    function genericSettingPath(segs) {
        const parts = [];
        for (let i = 0; i < segs.length; i++) {
            let key = segs[i].key;
            if (i === 1 && segs[0].key === 'columns') key = '<name>';
            else if (i === 2 && segs[0].key === 'structure' && segs[1].key === 'severities') key = '<rule>';
            else if (i === 2 && segs[0].key === 'comparison' && segs[1].key === 'fields') key = '<col>';
            parts.push(key + (segs[i].idx !== null ? '[]' : ''));
        }
        return parts.join('.');
    }

    // Canonical key ordering (Addendum §A.5): §4 section order, §11 key order,
    // `columns` insertion order preserved (it is semantic).
    const ORD = {
        top: ['meta', 'resultConfig', 'nullHandling', 'evaluation', 'structure', 'columns',
            'compositeKeys', 'customRowChecks', 'customTableChecks', 'comparison'],
        meta: ['schemaVersion', 'name', 'description'],
        resultConfig: ['maxSamples', 'maxErrors', 'maxErrorsPerColumn', 'collectCellRegister',
            'collectCellObservations', 'stopPolicy'],
        nullHandling: ['nullEquivalents'],
        evaluation: ['strictType', 'timezone'],
        structure: ['columnMatching', 'fieldNameMatching', 'rowCount', 'columnCount',
            'allowDuplicateRows', 'allowAllNullRows', 'allowDuplicateColumns', 'allowAllNullColumns',
            'duplicateColumnNames', 'allowExtraColumns', 'allowMissingColumns', 'enforceColumnOrder',
            'duplicateDetection', 'severities'],
        duplicateColumnNames: ['strategy', 'renamePattern'],
        duplicateDetection: ['matchStrategy'],
        severities: STRUCT_SEV_RULES,
        colDef: ['required', 'nullable', 'severity', 'stopOnFail', 'unique', 'nullHandling', 'evaluation', 'type'],
        colSeverity: ['default', 'byRule'],
        unique: ['enabled', 'nullsEqual'],
        typeBlock: ['name', 'length', 'regex', 'regexFlags', 'formats', 'value', 'precision',
            'trueValues', 'falseValues', 'allowedValues', 'typeStrict', 'matchStrategy'],
        range: ['min', 'max', 'minInclusive', 'maxInclusive'],
        sms: ['caseSensitive', 'trim', 'stripSpaces'],
        numberFormat: ['decimalSeparator', 'groupingSeparators', 'allowBareDecimal'],
        compositeKey: ['columns', 'nullsAllowed', 'severity'],
        rowCheck: ['name', 'type', 'severity', 'fieldA', 'fieldB', 'op', 'if', 'then', 'fields', 'expected', 'fn', 'params'],
        ifBlock: ['field', 'op', 'value'],
        thenBlock: ['field', 'nonNull'],
        tableCheck: ['name', 'type', 'severity', 'field', 'direction', 'start', 'fields',
            'expectedValue', 'expectedField', 'expectedFieldRow', 'tolerance', 'fn', 'params'],
        comparison: ['match', 'fields', 'severity', 'scope', 'diffChecks'],
        cmpMatch: ['keys', 'setMode', 'onDuplicateKey', 'fuzzy'],
        cmpFuzzy: ['components', 'threshold', 'metric', 'ambiguityMargin', 'maxCandidatePairs'],
        cmpField: ['compare', 'presence', 'expectedName', 'tolerance', 'fuzzy'],
        cmpTolerance: ['field', 'from', 'percent', 'of', 'fn'],
        cmpCellFuzzy: ['threshold', 'metric'],
        cmpSeverity: ['toleranceMatch', 'interpretedMatch', 'fuzzyMatch', 'crossTypeMismatch', 'valueMismatch',
            'fuzzyKeyMatch', 'ambiguousFuzzyMatch', 'rowMissing', 'rowUnexpected', 'columnOnlyOnOneSide',
            'duplicateMatchKey'],
        cmpScope: ['column', 'inScopeValues', 'outOfScopeValues', 'matchStrategy', 'outOfScopePolicy'],
        diffChecks: ['row', 'table'],
        diffCheck: ['name', 'type', 'severity', 'fn', 'params'],
    };

    function orderKeys(obj, order) {
        if (!isObj(obj)) return obj;
        const out = {};
        for (const k of order) if (obj[k] !== undefined) setOwn(out, k, obj[k]);
        for (const k of Object.keys(obj)) {
            if (!Object.prototype.hasOwnProperty.call(out, k) && obj[k] !== undefined) setOwn(out, k, obj[k]);
        }
        return out;
    }

    const ordRange = (r) => orderKeys(r, ORD.range);
    const ordSms = (s) => orderKeys(s, ORD.sms);

    function ordTypeBlock(t) {
        if (!isObj(t)) return t;
        const o = orderKeys(t, ORD.typeBlock);
        if (isObj(o.length)) o.length = ordRange(o.length);
        if (isObj(o.value)) o.value = ordRange(o.value);
        if (isObj(o.precision)) o.precision = ordRange(o.precision);
        if (isObj(o.matchStrategy)) o.matchStrategy = ordSms(o.matchStrategy);
        if (Array.isArray(o.formats)) {
            o.formats = o.formats.map((f) => (isObj(f) ? orderKeys(f, ORD.numberFormat) : f));
        }
        return o;
    }

    function canonicalizeConfig(doc) {
        const d = orderKeys(doc, ORD.top);
        if (isObj(d.meta)) d.meta = orderKeys(d.meta, ORD.meta);
        if (isObj(d.resultConfig)) d.resultConfig = orderKeys(d.resultConfig, ORD.resultConfig);
        if (isObj(d.nullHandling)) d.nullHandling = orderKeys(d.nullHandling, ORD.nullHandling);
        if (isObj(d.evaluation)) d.evaluation = orderKeys(d.evaluation, ORD.evaluation);
        if (isObj(d.structure)) {
            d.structure = orderKeys(d.structure, ORD.structure);
            if (isObj(d.structure.fieldNameMatching)) d.structure.fieldNameMatching = ordSms(d.structure.fieldNameMatching);
            if (isObj(d.structure.rowCount)) d.structure.rowCount = ordRange(d.structure.rowCount);
            if (isObj(d.structure.columnCount)) d.structure.columnCount = ordRange(d.structure.columnCount);
            if (isObj(d.structure.duplicateColumnNames)) {
                d.structure.duplicateColumnNames = orderKeys(d.structure.duplicateColumnNames, ORD.duplicateColumnNames);
            }
            if (isObj(d.structure.duplicateDetection)) {
                d.structure.duplicateDetection = orderKeys(d.structure.duplicateDetection, ORD.duplicateDetection);
                if (isObj(d.structure.duplicateDetection.matchStrategy)) {
                    d.structure.duplicateDetection.matchStrategy = ordSms(d.structure.duplicateDetection.matchStrategy);
                }
            }
            if (isObj(d.structure.severities)) d.structure.severities = orderKeys(d.structure.severities, ORD.severities);
        }
        if (isObj(d.columns)) {
            const cols = {};
            for (const [name, def] of Object.entries(d.columns)) {   // insertion order preserved
                if (!isObj(def)) { cols[name] = def; continue; }
                const c = orderKeys(def, ORD.colDef);
                if (isObj(c.severity)) c.severity = orderKeys(c.severity, ORD.colSeverity);
                if (isObj(c.unique)) c.unique = orderKeys(c.unique, ORD.unique);
                if (isObj(c.type)) c.type = ordTypeBlock(c.type);
                cols[name] = c;
            }
            d.columns = cols;
        }
        if (Array.isArray(d.compositeKeys)) {
            d.compositeKeys = d.compositeKeys.map((k) => (isObj(k) ? orderKeys(k, ORD.compositeKey) : k));
        }
        if (Array.isArray(d.customRowChecks)) {
            d.customRowChecks = d.customRowChecks.map((c) => {
                if (!isObj(c)) return c;
                const o = orderKeys(c, ORD.rowCheck);
                if (isObj(o.if)) o.if = orderKeys(o.if, ORD.ifBlock);
                if (isObj(o.then)) o.then = orderKeys(o.then, ORD.thenBlock);
                return o;
            });
        }
        if (Array.isArray(d.customTableChecks)) {
            d.customTableChecks = d.customTableChecks.map((c) => (isObj(c) ? orderKeys(c, ORD.tableCheck) : c));
        }
        if (isObj(d.comparison)) {
            const c = orderKeys(d.comparison, ORD.comparison);
            if (isObj(c.match)) {
                c.match = orderKeys(c.match, ORD.cmpMatch);
                if (isObj(c.match.fuzzy)) c.match.fuzzy = orderKeys(c.match.fuzzy, ORD.cmpFuzzy);
            }
            if (isObj(c.fields)) {
                const f = {};
                for (const [name, spec] of Object.entries(c.fields)) {
                    if (!isObj(spec)) { f[name] = spec; continue; }
                    const s = orderKeys(spec, ORD.cmpField);
                    if (isObj(s.tolerance)) s.tolerance = orderKeys(s.tolerance, ORD.cmpTolerance);
                    if (isObj(s.fuzzy)) s.fuzzy = orderKeys(s.fuzzy, ORD.cmpCellFuzzy);
                    f[name] = s;
                }
                c.fields = f;
            }
            if (isObj(c.severity)) c.severity = orderKeys(c.severity, ORD.cmpSeverity);
            if (isObj(c.scope)) {
                c.scope = orderKeys(c.scope, ORD.cmpScope);
                if (isObj(c.scope.matchStrategy)) c.scope.matchStrategy = ordSms(c.scope.matchStrategy);
            }
            if (isObj(c.diffChecks)) {
                c.diffChecks = orderKeys(c.diffChecks, ORD.diffChecks);
                for (const level of ['row', 'table']) {
                    if (Array.isArray(c.diffChecks[level])) {
                        c.diffChecks[level] = c.diffChecks[level].map((chk) =>
                            (isObj(chk) ? orderKeys(chk, ORD.diffCheck) : chk));
                    }
                }
            }
            d.comparison = c;
        }
        return d;
    }

    // Fully-resolved preview (Addendum §A.4 `resolvedPreview()`): §12 / §15.12 defaults
    // applied on a copy; overrides resolved; effective `required` derived. Inspection only —
    // resolution proper remains the engine's Phase-2 job. Idempotent.
    function resolvedPreviewOf(raw) {
        const d = jsonClone(raw);
        const fill = (obj, defs) => Object.assign({}, defs, isObj(obj) ? obj : {});
        d.meta = fill(d.meta, { description: '' });
        d.resultConfig = fill(d.resultConfig, {
            maxSamples: 5, maxErrors: null, maxErrorsPerColumn: null,
            collectCellRegister: false, collectCellObservations: false, stopPolicy: 'never',
        });
        d.nullHandling = fill(d.nullHandling, { nullEquivalents: [] });
        d.evaluation = fill(d.evaluation, { strictType: true, timezone: 'utc' });
        const st = fill(d.structure, {
            columnMatching: 'byName', rowCount: jsonClone(DEF_RANGE), columnCount: jsonClone(DEF_RANGE),
            allowDuplicateRows: true, allowAllNullRows: true, allowDuplicateColumns: true,
            allowAllNullColumns: true, allowExtraColumns: false, allowMissingColumns: false,
            enforceColumnOrder: false,
        });
        st.fieldNameMatching = fill(st.fieldNameMatching, DEF_SMS_LOOSE);
        st.duplicateColumnNames = fill(st.duplicateColumnNames, { strategy: 'halt', renamePattern: '{name}~{index}' });
        st.duplicateDetection = { matchStrategy: fill(isObj(st.duplicateDetection) ? st.duplicateDetection.matchStrategy : undefined, DEF_SMS_STRICT) };
        const sevDefaults = {};
        for (const rn of STRUCT_SEV_RULES) sevDefaults[rn] = rn === 'duplicateColumnName' ? 'warning' : 'error';
        st.severities = fill(st.severities, sevDefaults);
        d.structure = st;
        if (isObj(d.columns)) {
            for (const [name, def0] of Object.entries(d.columns)) {
                if (!isObj(def0)) continue;
                const def = fill(def0, { nullable: false, severity: 'error', stopOnFail: false });
                def.required = def.required !== undefined && def.required !== null
                    ? def.required : !st.allowMissingColumns;
                def.unique = fill(def.unique, { enabled: false, nullsEqual: false });
                const colNe = isObj(def.nullHandling) ? def.nullHandling.nullEquivalents : undefined;
                def.nullHandling = { nullEquivalents: colNe != null ? colNe : jsonClone(d.nullHandling.nullEquivalents) };
                const colSt = isObj(def.evaluation) ? def.evaluation.strictType : undefined;
                def.evaluation = { strictType: colSt != null ? colSt : d.evaluation.strictType };
                if (isObj(def.type)) {
                    const tn = def.type.name;
                    if (tn === 'string') def.type = fill(def.type, { length: null, regex: null, regexFlags: null });
                    else if (tn === 'int') def.type = fill(def.type, { formats: null, value: null });
                    else if (tn === 'float') def.type = fill(def.type, { formats: null, value: null, precision: null });
                    else if (tn === 'bool') {
                        def.type = fill(def.type, { trueValues: ['true', '1', 'yes'], falseValues: ['false', '0', 'no'] });
                        def.type.matchStrategy = fill(def.type.matchStrategy, DEF_SMS_LOOSE);
                    } else if (TEMPORAL[tn]) def.type = fill(def.type, { value: null });
                    else if (tn === 'categorical') {
                        def.type = fill(def.type, { typeStrict: false });
                        def.type.matchStrategy = fill(def.type.matchStrategy, DEF_SMS_LOOSE);
                    }
                }
                d.columns[name] = def;
            }
        }
        d.compositeKeys = (Array.isArray(d.compositeKeys) ? d.compositeKeys : [])
            .map((k) => (isObj(k) ? fill(k, { nullsAllowed: false, severity: 'error' }) : k));
        d.customRowChecks = (Array.isArray(d.customRowChecks) ? d.customRowChecks : [])
            .map((c) => {
                if (!isObj(c)) return c;
                const o = fill(c, { severity: 'error' });
                if (o.type === 'custom' && o.params === undefined) o.params = null;
                return o;
            });
        d.customTableChecks = (Array.isArray(d.customTableChecks) ? d.customTableChecks : [])
            .map((c) => {
                if (!isObj(c)) return c;
                const o = fill(c, { severity: 'error' });
                if (o.type === 'sumEquals' && o.tolerance === undefined) o.tolerance = 0;
                if (o.type === 'sequenceNoGaps' && o.start === undefined) o.start = null;
                if (o.type === 'custom' && o.params === undefined) o.params = null;
                return o;
            });
        if (isObj(d.comparison)) {
            const c = d.comparison;
            if (isObj(c.match)) {
                if (c.match.setMode === undefined) c.match.setMode = 'exact';
                if (c.match.onDuplicateKey === undefined) c.match.onDuplicateKey = 'abort';
                if (c.match.fuzzy === undefined) c.match.fuzzy = null;
                if (isObj(c.match.fuzzy)) {
                    c.match.fuzzy = fill(c.match.fuzzy, { metric: 'tokenizedFuzzy', ambiguityMargin: 0, maxCandidatePairs: 1000000 });
                }
            }
            c.fields = isObj(c.fields) ? c.fields : {};
            for (const [name, spec] of Object.entries(c.fields)) {
                if (!isObj(spec)) continue;
                c.fields[name] = fill(spec, { compare: true, presence: 'both', expectedName: null, tolerance: null, fuzzy: null });
                if (isObj(c.fields[name].fuzzy)) c.fields[name].fuzzy = fill(c.fields[name].fuzzy, { metric: 'tokenizedFuzzy' });
            }
            const setMode = isObj(c.match) && c.match.setMode !== undefined ? c.match.setMode : 'exact';
            c.severity = fill(c.severity, Object.assign({}, DEFAULT_CMP_SEV, {
                rowMissing: setMode === 'subset' ? 'none' : 'error',
                rowUnexpected: setMode === 'superset' ? 'none' : 'error',
            }));
            if (c.scope === undefined) c.scope = null;
            if (isObj(c.scope)) {
                c.scope = fill(c.scope, { outOfScopePolicy: 'compare' });
                c.scope.matchStrategy = fill(c.scope.matchStrategy, DEF_SMS_LOOSE);
            }
            c.diffChecks = fill(c.diffChecks, { row: [], table: [] });
            for (const level of ['row', 'table']) {
                if (Array.isArray(c.diffChecks[level])) {
                    c.diffChecks[level] = c.diffChecks[level].map((chk) => {
                        if (!isObj(chk)) return chk;
                        const o = fill(chk, { severity: 'error' });
                        if (o.params === undefined) o.params = null;
                        return o;
                    });
                }
            }
        }
        return canonicalizeConfig(d);
    }

    // Referenced custom-function names, by rule family (for deferred detection)
    function collectFnRefs(doc) {
        const refs = { checks: false, tolerance: false, diff: false };
        for (const key of ['customRowChecks', 'customTableChecks']) {
            for (const chk of (Array.isArray(doc[key]) ? doc[key] : [])) {
                if (isObj(chk) && chk.type === 'custom' && isStr(chk.fn)) refs.checks = true;
            }
        }
        const c = doc.comparison;
        if (isObj(c)) {
            if (isObj(c.fields)) {
                for (const spec of Object.values(c.fields)) {
                    if (isObj(spec) && isObj(spec.tolerance) && isStr(spec.tolerance.fn)) refs.tolerance = true;
                }
            }
            if (isObj(c.diffChecks)) {
                for (const level of ['row', 'table']) {
                    for (const chk of (Array.isArray(c.diffChecks[level]) ? c.diffChecks[level] : [])) {
                        if (isObj(chk) && chk.type === 'custom' && isStr(chk.fn)) refs.diff = true;
                    }
                }
            }
        }
        return refs;
    }

    const BUILDER_DEFAULT_SEED = { meta: { schemaVersion: '1.2.0', name: '' }, columns: {} };

    function createConfigBuilder(seed) {
        if (seed !== undefined && seed !== null && !isObj(seed)) {
            throw new TableValidationConfigError('createConfigBuilder seed must be a plain object');
        }
        const doc = jsonClone(seed != null ? seed : BUILDER_DEFAULT_SEED);

        function setAt(path, value) {
            const segs = parseSettingPath(path);
            const generic = genericSettingPath(segs);
            if (!MODEL_PATHS.has(generic)) {
                throw new TableValidationConfigError(
                    `"${path}" is not a setting path enumerated in the config meta-model (resolved as "${generic}")`);
            }
            let node = doc;
            for (let i = 0; i < segs.length; i++) {
                const { key, idx } = segs[i];
                const last = i === segs.length - 1;
                if (idx !== null) {
                    if (!Array.isArray(node[key])) node[key] = [];
                    const arr = node[key];
                    if (idx > arr.length) {
                        throw new TableValidationConfigError(`array index ${idx} in "${path}" skips positions (length ${arr.length})`);
                    }
                    if (last) { arr[idx] = jsonClone(value); return; }
                    if (!isObj(arr[idx])) arr[idx] = {};
                    node = arr[idx];
                } else if (last) {
                    node[key] = jsonClone(value);
                    return;
                } else {
                    if (!isObj(node[key])) node[key] = {};
                    node = node[key];
                }
            }
        }

        function getAt(path) {
            const segs = parseSettingPath(path);
            let node = doc;
            for (const { key, idx } of segs) {
                if (!isObj(node) && !Array.isArray(node)) return undefined;
                node = isObj(node) ? node[key] : undefined;
                if (idx !== null) node = Array.isArray(node) ? node[idx] : undefined;
                if (node === undefined) return undefined;
            }
            return jsonClone(node);
        }

        function unsetAt(path) {
            const segs = parseSettingPath(path);
            const generic = genericSettingPath(segs);
            if (!MODEL_PATHS.has(generic)) {
                throw new TableValidationConfigError(`"${path}" is not a setting path enumerated in the config meta-model`);
            }
            let node = doc;
            for (let i = 0; i < segs.length - 1; i++) {
                const { key, idx } = segs[i];
                node = isObj(node) ? node[key] : undefined;
                if (idx !== null) node = Array.isArray(node) ? node[idx] : undefined;
                if (node === undefined) return;
            }
            const leaf = segs[segs.length - 1];
            if (leaf.idx !== null) {
                if (isObj(node) && Array.isArray(node[leaf.key])) node[leaf.key][leaf.idx] = undefined;
            } else if (isObj(node)) {
                delete node[leaf.key];
            }
        }

        const builder = {
            set(path, value) { setAt(path, value); return builder; },
            get(path) { return getAt(path); },
            unset(path) { unsetAt(path); return builder; },

            addColumn(name, definition) {
                if (!isStr(name) || name.length === 0) throw new TableValidationConfigError('addColumn: name must be a non-empty string');
                if (!isObj(doc.columns)) doc.columns = {};
                if (doc.columns[name] !== undefined) throw new TableValidationConfigError(`addColumn: column "${name}" already exists`);
                doc.columns[name] = jsonClone(definition !== undefined ? definition : {});
                return builder;
            },
            removeColumn(name) {
                if (!isObj(doc.columns) || doc.columns[name] === undefined) {
                    throw new TableValidationConfigError(`removeColumn: column "${name}" does not exist`);
                }
                delete doc.columns[name];
                return builder;
            },
            moveColumn(name, toIndex) {
                if (!isObj(doc.columns) || doc.columns[name] === undefined) {
                    throw new TableValidationConfigError(`moveColumn: column "${name}" does not exist`);
                }
                const names = Object.keys(doc.columns);
                if (!isIntN(toIndex) || toIndex < 0 || toIndex >= names.length) {
                    throw new TableValidationConfigError(`moveColumn: toIndex must be an integer in [0, ${names.length - 1}]`);
                }
                names.splice(names.indexOf(name), 1);
                names.splice(toIndex, 0, name);
                const next = {};
                for (const n of names) next[n] = doc.columns[n];
                doc.columns = next;
                return builder;
            },
            addCompositeKey(def) {
                if (!Array.isArray(doc.compositeKeys)) doc.compositeKeys = [];
                doc.compositeKeys.push(jsonClone(def));
                return builder;
            },
            addRowCheck(def) {
                if (!Array.isArray(doc.customRowChecks)) doc.customRowChecks = [];
                doc.customRowChecks.push(jsonClone(def));
                return builder;
            },
            addTableCheck(def) {
                if (!Array.isArray(doc.customTableChecks)) doc.customTableChecks = [];
                doc.customTableChecks.push(jsonClone(def));
                return builder;
            },
            setComparison(def) {
                if (def === null || def === undefined) delete doc.comparison;
                else if (isObj(def)) doc.comparison = jsonClone(def);
                else throw new TableValidationConfigError('setComparison expects an object or null');
                return builder;
            },

            // Authoring-time validation (Addendum §A.4; rule M6): the engines' Phase-1 rule
            // set + the §8.2 advisory preview. Rules needing runtime bindings are checked when
            // the binding is supplied, otherwise reported in `deferred` — never silently passed.
            // Rule 4 (IANA zone) is always checkable in this profile: Luxon when present, Intl otherwise.
            validate(options) {
                const o = options === undefined || options === null ? {} : options;
                if (!isObj(o)) throw new TableValidationConfigError('validate options must be an object');
                const errors = [];
                const advisories = [];
                const deferred = [];
                const intendedUse = o.intendedUse !== undefined ? o.intendedUse
                    : (doc.comparison !== undefined ? 'both' : 'validate');
                if (!['validate', 'compare', 'both'].includes(intendedUse)) {
                    throw new TableValidationConfigError('options.intendedUse must be "validate", "compare", or "both"');
                }
                let fns;
                if (o.functions !== undefined && o.functions !== null) {
                    if (!isObj(o.functions)) throw new TableValidationConfigError('options.functions must be an object');
                    fns = o.functions;
                } else {
                    // No registry supplied: rule 30 / C5 / C8 function-existence checks are deferred
                    const refs = collectFnRefs(doc);
                    if (refs.checks) deferred.push('10:30');
                    if (refs.tolerance) deferred.push('C5');
                    if (refs.diff) deferred.push('C8');
                    const pass = function () {};
                    fns = new Proxy({}, { get: () => pass });
                }
                // Exhaustive authoring errors (Addendum §A.4): run Phase 1 in accumulate
                // mode — one recorded violation per independent check unit, so N seeded
                // independent defects yield N errors in one pass. The engines keep their
                // abort-on-first fast path (throw mode).
                const collected = collectPhase1Errors(() => {
                    validateSchemaPhase1(doc, fns);
                    if (doc.comparison !== undefined || intendedUse !== 'validate') {
                        validateComparisonConfig(doc, fns);
                    }
                });
                for (const e of collected) errors.push(jsonClone(e));
                if (errors.length === 0) {
                    // Non-mutating Phase-2 preview: capture irrelevantSetting advisories
                    const stub = {
                        record(phase, sev, rule, entries) {
                            for (const en of entries) advisories.push(jsonClone(en.context));
                        },
                    };
                    resolveSchema(doc, stub);
                }
                return { valid: errors.length === 0, errors, advisories, deferred };
            },

            build() { return canonicalizeConfig(jsonClone(doc)); },
            resolvedPreview() { return resolvedPreviewOf(doc); },
        };
        return builder;
    }

    // ================================================================
    // Addendum §B — Ingestion engine (JS spec §3.12, §4.8)
    // ================================================================

    class TableValidationIngestError extends Error {
        constructor(code, message, detail) {
            super(message);
            this.name = 'TableValidationIngestError';
            this.code = code;
            this.detail = detail !== undefined ? detail : null;
        }
    }

    const INGEST_FORMATS = ['csv', 'tsv', 'xlsx', 'jsonArrays', 'jsonObjects'];
    const INGEST_TOP_KEYS = ['format', 'header', 'csv', 'xlsx', 'skipRows', 'skipFooterRows', 'limits', 'normalization'];
    const INGEST_SUB_KEYS = { header: ['mode', 'names'], csv: ['delimiter', 'quote', 'encoding'], xlsx: ['sheet'], limits: ['maxRows', 'maxColumns', 'maxCells', 'maxBytes'] };
    const INGEST_LIMIT_DEFAULTS = { maxRows: 1000000, maxColumns: 10000, maxCells: 10000000, maxBytes: 268435456 };

    // ----------------------------------------------------------------
    // Normalization pipeline (Addendum §B.8) — the sanctioned external home for
    // transformation (Core §1.3). Applied between the raw parse (after header
    // extraction) and the emitted TableInput; header cells are never normalized.
    // Steps execute as PASSES over each target column (rows in order): for the pure
    // per-cell built-ins a pass equals per-cell composition; `fillDown` is the one
    // documented exception, carrying top-to-bottom state within its pass.
    // ----------------------------------------------------------------

    const normTrimEnds = (v) => v.replace(/^\s+|\s+$/g, '');

    // Core §3.5 steps 1–4 on a working copy → the canonical "."-decimal string, or
    // null when the string does not interpret. The working copy (never a Number
    // round-trip) preserves lexical precision: "1.234,50" → "1234.50", not "1234.5".
    function normNumberWorkingCopy(str, fmt) {
        let w = str;
        for (const g of (fmt.groupingSeparators || [])) w = w.split(g).join('');
        if (fmt.decimalSeparator != null) {
            const first = w.indexOf(fmt.decimalSeparator);
            if (first !== -1) {
                if (w.indexOf(fmt.decimalSeparator, first + fmt.decimalSeparator.length) !== -1) return null;
                w = w.slice(0, first) + '.' + w.slice(first + fmt.decimalSeparator.length);
            }
        }
        if (FLOAT_RE.test(w)) return w;
        // §3.5 bare decimal (1.2.0): the working copy canonicalizes ".85" → "0.85"
        if (fmt.allowBareDecimal === true && /^[+-]?\.[0-9]+$/.test(w)) {
            return (w[0] === '+' || w[0] === '-') ? w[0] + '0' + w.slice(1) : '0' + w;
        }
        return null;
    }

    // convert a schemaFail marker thrown by a shared shape checker into an I-rule error
    function normShapeCheck(fn, bad) {
        try { fn(); } catch (e) {
            if (e && e.__tvSchemaFail) bad(e.__tvSchemaFail.path, e.__tvSchemaFail.expected, e.__tvSchemaFail.actual);
            else throw e;
        }
    }

    // Built-in registry (Addendum §B.8 table). Every built-in is a total per-cell map
    // ("otherwise unchanged" — unparseable content flows through to validate()),
    // except fillDown (perColumnOnly, pass-based). Each entry:
    //   checkParams(params, path, bad) — I9 params-shape validation at spec time
    //   prepare(params) → ctx          — per-step setup (defaults, sorting), once per pass
    //   cell(cell, ctx) → cell         — the pure per-cell map
    //   pass(rowCount, get, set, ctx)  — full-column pass (fillDown only)
    const NORMALIZATION_BUILTINS = {
        trim: {
            checkParams(p, path, bad) {
                if (p.collapseInternal !== undefined && !isBool(p.collapseInternal)) bad(`${path}.collapseInternal`, 'boolean', p.collapseInternal);
            },
            prepare: (p) => ({ collapse: p.collapseInternal !== false }),
            cell(cell, ctx) {
                if (!isStr(cell)) return cell;
                const t = normTrimEnds(cell);
                return ctx.collapse ? t.replace(/\s+/g, ' ') : t;
            },
        },
        caseFold: {
            checkParams(p, path, bad) {
                if (p.to !== undefined && p.to !== 'lower' && p.to !== 'upper') bad(`${path}.to`, '"lower" or "upper"', p.to);
            },
            prepare: (p) => ({ upper: p.to === 'upper' }),
            cell: (cell, ctx) => isStr(cell) ? (ctx.upper ? cell.toUpperCase() : cell.toLowerCase()) : cell,
        },
        nullCoerce: {
            checkParams(p, path, bad) {
                if (!(Array.isArray(p.equivalents) && p.equivalents.length > 0 && p.equivalents.every(isStr))) {
                    bad(`${path}.equivalents`, 'non-empty string array (required)', p.equivalents);
                }
            },
            prepare: (p) => ({ eq: new Set(p.equivalents) }),
            cell: (cell, ctx) => isStr(cell) && ctx.eq.has(cell) ? null : cell,
        },
        reformatNumber: {
            checkParams(p, path, bad) {
                if (!isObj(p.format)) { bad(`${path}.format`, 'NumberFormat object (required)', p.format); return; }
                normShapeCheck(() => checkNumberFormatShape(p.format, `${path}.format`), bad);
            },
            prepare: (p) => ({ format: p.format }),
            cell(cell, ctx) {
                if (!isStr(cell)) return cell;
                const w = normNumberWorkingCopy(cell, ctx.format);
                return w === null ? cell : w;
            },
        },
        reformatTemporal: {
            checkParams(p, path, bad) {
                if (!(Array.isArray(p.from) && p.from.length > 0 && p.from.every(isStr))) {
                    bad(`${path}.from`, 'non-empty array of temporal format strings (required)', p.from);
                } else {
                    p.from.forEach((f, i) => { if (scanFormatTokens(f) == null) bad(`${path}.from[${i}]`, 'valid temporal format (Core §13.3 tokens)', f); });
                }
                if (!isStr(p.to)) bad(`${path}.to`, 'temporal format string (required)', p.to);
                else if (scanFormatTokens(p.to) == null) bad(`${path}.to`, 'valid temporal format (Core §13.3 tokens)', p.to);
            },
            prepare: (p) => ({ from: p.from, to: p.to }),
            cell(cell, ctx) {
                if (!isStr(cell)) return cell;
                const l = getLuxon();
                for (const f of ctx.from) {
                    const dt = l.DateTime.fromFormat(cell, f, { zone: 'utc' });
                    if (dt.isValid) return dt.toFormat(ctx.to);
                }
                return cell;
            },
        },
        promoteNumber: {
            checkParams(p, path, bad) {
                if (p.format !== undefined && p.format !== null) {
                    if (!isObj(p.format)) { bad(`${path}.format`, 'NumberFormat object or null', p.format); return; }
                    normShapeCheck(() => checkNumberFormatShape(p.format, `${path}.format`), bad);
                }
            },
            prepare: (p) => ({ format: isObj(p.format) ? p.format : null }),
            cell(cell, ctx) {
                if (!isStr(cell)) return cell;
                if (FLOAT_RE.test(cell)) return Number(cell);
                if (ctx.format) {
                    const r = interpretNumberFormat(cell, ctx.format, false);
                    if (r !== null) return r.value;
                }
                return cell;
            },
        },
        promoteBool: {
            checkParams(p, path, bad) {
                for (const k of ['trueValues', 'falseValues']) {
                    if (p[k] !== undefined && !(Array.isArray(p[k]) && p[k].length > 0 && p[k].every(isStr))) {
                        bad(`${path}.${k}`, 'non-empty string array', p[k]);
                    }
                }
                if (p.matchStrategy !== undefined) normShapeCheck(() => checkStrategyShape(p.matchStrategy, `${path}.matchStrategy`), bad);
                const ms = effStrategy(p.matchStrategy, [false, true, false]);
                const tv = Array.isArray(p.trueValues) && p.trueValues.every(isStr) ? p.trueValues : ['true', '1', 'yes'];
                const fv = Array.isArray(p.falseValues) && p.falseValues.every(isStr) ? p.falseValues : ['false', '0', 'no'];
                const overlap = tv.map((x) => applyStrategy(x, ms)).find((x) => fv.map((y) => applyStrategy(y, ms)).includes(x));
                if (overlap !== undefined) bad(`${path}.trueValues`, 'no overlap with falseValues after matchStrategy', overlap);
            },
            prepare(p) {
                const ms = effStrategy(p.matchStrategy, [false, true, false]);
                const norm = (a, d) => new Set((Array.isArray(a) ? a : d).map((x) => applyStrategy(x, ms)));
                return { ms, tv: norm(p.trueValues, ['true', '1', 'yes']), fv: norm(p.falseValues, ['false', '0', 'no']) };
            },
            cell(cell, ctx) {
                if (!isStr(cell)) return cell;
                const probe = applyStrategy(cell, ctx.ms);
                if (ctx.tv.has(probe)) return true;
                if (ctx.fv.has(probe)) return false;
                return cell;
            },
        },
        stripAffix: {
            checkParams(p, path, bad) {
                const okList = (v) => Array.isArray(v) && v.every((x) => isStr(x) && x.length > 0);
                if (p.prefixes !== undefined && !okList(p.prefixes)) bad(`${path}.prefixes`, 'array of non-empty strings', p.prefixes);
                if (p.suffixes !== undefined && !okList(p.suffixes)) bad(`${path}.suffixes`, 'array of non-empty strings', p.suffixes);
                if (p.alsoTrim !== undefined && !isBool(p.alsoTrim)) bad(`${path}.alsoTrim`, 'boolean', p.alsoTrim);
                const nPre = Array.isArray(p.prefixes) ? p.prefixes.length : 0;
                const nSuf = Array.isArray(p.suffixes) ? p.suffixes.length : 0;
                if (nPre + nSuf === 0) bad(path, 'at least one prefix or suffix', p);
            },
            prepare(p) {
                // longest-match-first; equal lengths tie-break lexicographically (deterministic)
                const desc = (a) => (Array.isArray(a) ? a.slice() : []).sort((x, y) => y.length - x.length || (x < y ? -1 : x > y ? 1 : 0));
                return { prefixes: desc(p.prefixes), suffixes: desc(p.suffixes), alsoTrim: p.alsoTrim !== false };
            },
            cell(cell, ctx) {
                if (!isStr(cell)) return cell;
                let sv = ctx.alsoTrim ? normTrimEnds(cell) : cell;
                for (const pre of ctx.prefixes) if (sv.startsWith(pre)) { sv = sv.slice(pre.length); break; }
                for (const suf of ctx.suffixes) if (suf.length <= sv.length && sv.endsWith(suf)) { sv = sv.slice(0, sv.length - suf.length); break; }
                return ctx.alsoTrim ? normTrimEnds(sv) : sv;
            },
        },
        replaceChars: {
            checkParams(p, path, bad) {
                if (!isObj(p.map) || Object.keys(p.map).length === 0) { bad(`${path}.map`, 'non-empty { <from>: <to> } object (required)', p.map); return; }
                for (const k of Object.keys(p.map)) {
                    if (k.length === 0) bad(`${path}.map`, 'non-empty "from" keys', k);
                    if (!isStr(p.map[k])) bad(`${path}.map.${JSON.stringify(k)}`, 'string replacement value', p.map[k]);
                }
            },
            prepare: (p) => ({ entries: Object.keys(p.map).map((k) => [k, p.map[k]]) }),
            cell(cell, ctx) {
                if (!isStr(cell)) return cell;
                let sv = cell;
                for (const [from, to] of ctx.entries) sv = sv.split(from).join(to);
                return sv;
            },
        },
        fillDown: {
            perColumnOnly: true,     // vertical state — the documented §B.8 determinism exception
            checkParams(p, path, bad) {
                if (p.treatAsEmpty !== undefined && !(Array.isArray(p.treatAsEmpty) && p.treatAsEmpty.every(isStr))) {
                    bad(`${path}.treatAsEmpty`, 'array of strings', p.treatAsEmpty);
                }
            },
            prepare: (p) => ({ empty: new Set(p.treatAsEmpty !== undefined ? p.treatAsEmpty : ['']) }),
            pass(rowCount, get, set, ctx) {
                let carry;
                for (let r = 0; r < rowCount; r++) {
                    const c = get(r);
                    if (c === undefined) continue;              // ragged short row: no cell to fill
                    const isEmpty = c === null || (isStr(c) && ctx.empty.has(c));
                    if (isEmpty) { if (carry !== undefined) set(r, carry); }
                    else carry = c;
                }
            },
        },
    };

    // Machine-readable registry descriptor (JS spec §3.12) — the console's
    // normalization step editor renders from this, never from a hard-coded list.
    const normalizationModel = [
        { fn: 'trim', perColumnOnly: false, doc: 'Strings: strip leading/trailing whitespace; collapse internal whitespace runs to one space.', params: [{ name: 'collapseInternal', type: 'bool', required: false, default: true }] },
        { fn: 'caseFold', perColumnOnly: false, doc: 'Strings: Unicode simple lowercase (or uppercase).', params: [{ name: 'to', type: 'enum', enum: ['lower', 'upper'], required: false, default: 'lower' }] },
        { fn: 'nullCoerce', perColumnOnly: false, doc: 'A string exactly matching a listed equivalent becomes native null.', params: [{ name: 'equivalents', type: 'string[]', required: true }] },
        { fn: 'reformatNumber', perColumnOnly: false, doc: 'A string interpretable under the NumberFormat becomes its canonical "."-decimal string (lexical precision preserved); otherwise unchanged.', params: [{ name: 'format', type: 'NumberFormat', required: true }] },
        { fn: 'reformatTemporal', perColumnOnly: false, doc: 'A string parseable by a "from" format is re-rendered in the "to" format; otherwise unchanged. Requires Luxon.', params: [{ name: 'from', type: 'string[]', required: true }, { name: 'to', type: 'string', required: true }] },
        { fn: 'promoteNumber', perColumnOnly: false, doc: 'A string interpretable as a number (direct strict parse, or the given format) becomes a native number; otherwise unchanged.', params: [{ name: 'format', type: 'NumberFormat|null', required: false, default: null }] },
        { fn: 'promoteBool', perColumnOnly: false, doc: 'A string matching a true/false list (after the match strategy) becomes a native boolean; otherwise unchanged.', params: [{ name: 'trueValues', type: 'string[]', required: false, default: ['true', '1', 'yes'] }, { name: 'falseValues', type: 'string[]', required: false, default: ['false', '0', 'no'] }, { name: 'matchStrategy', type: 'StringMatchStrategy', required: false, default: { caseSensitive: false, trim: true, stripSpaces: false } }] },
        { fn: 'stripAffix', perColumnOnly: false, doc: 'Strings: remove at most one declared prefix and one suffix (longest match first) — currency symbols, %, units.', params: [{ name: 'prefixes', type: 'string[]', required: false, default: [] }, { name: 'suffixes', type: 'string[]', required: false, default: [] }, { name: 'alsoTrim', type: 'bool', required: false, default: true }] },
        { fn: 'replaceChars', perColumnOnly: false, doc: 'Exact substring substitution map (NBSP→space, dash/quote variants), applied left-to-right over map insertion order.', params: [{ name: 'map', type: 'object', required: true }] },
        { fn: 'fillDown', perColumnOnly: true, doc: 'Per-column only: an effectively-empty cell (null or a listed string) takes the nearest non-empty value above it, top to bottom.', params: [{ name: 'treatAsEmpty', type: 'string[]', required: false, default: [''] }] },
    ];
    (function freezeDeep(o) {
        Object.freeze(o);
        for (const k of Object.keys(o)) {
            const v = o[k];
            if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) freezeDeep(v);
        }
    })(normalizationModel);

    // NormalizationSpec validation (rules I8–I10 + per-built-in params shapes)
    function checkNormalizationSpec(norm, headerless, normFns, bad) {
        if (!isObj(norm)) { bad('normalization', 'null or a NormalizationSpec object', norm); return; }
        for (const k of Object.keys(norm)) {                                                  // I11
            if (k !== 'table' && k !== 'columns') bad(`normalization.${k}`, 'a known NormalizationSpec key ("table", "columns")', k);
        }
        const checkSteps = (steps, path, tableLevel) => {
            if (!Array.isArray(steps)) { bad(path, 'array of { fn, params } steps', steps); return; }
            steps.forEach((stp, i) => {
                const sp = `${path}[${i}]`;
                if (!isObj(stp)) { bad(sp, 'NormalizationStep object', stp); return; }
                for (const k of Object.keys(stp)) if (k !== 'fn' && k !== 'params') bad(`${sp}.${k}`, 'a known step key ("fn", "params")', k);
                if (!isStr(stp.fn) || stp.fn.length === 0) { bad(`${sp}.fn`, 'function name string', stp.fn); return; }
                const builtin = NORMALIZATION_BUILTINS[stp.fn];
                const hosted = typeof normFns[stp.fn] === 'function';
                if (!builtin && !hosted) { bad(`${sp}.fn`, 'a built-in or registered normalization function', stp.fn); return; }   // I9
                if (stp.params !== undefined && stp.params !== null && !isObj(stp.params)) { bad(`${sp}.params`, 'object or null', stp.params); return; }
                if (builtin) {
                    if (tableLevel && builtin.perColumnOnly) bad(`${sp}.fn`, `"${stp.fn}" is per-column only (normalization.columns)`, stp.fn);
                    builtin.checkParams(isObj(stp.params) ? stp.params : {}, `${sp}.params`, bad);
                }
            });
        };
        if (norm.table !== undefined) checkSteps(norm.table, 'normalization.table', true);
        if (norm.columns !== undefined) {
            if (!isObj(norm.columns)) { bad('normalization.columns', 'object keyed by header name (or 0-based position for headerless sources)', norm.columns); return; }
            for (const key of Object.keys(norm.columns)) {
                if (headerless && !/^\d+$/.test(key)) {                                       // I10
                    bad(`normalization.columns.${JSON.stringify(key)}`, 'a non-negative integer position key (headerless source)', key);
                }
                checkSteps(norm.columns[key], `normalization.columns.${JSON.stringify(key)}`, false);
            }
        }
    }

    // Pipeline execution (Addendum §B.8): all table-level steps first, then each
    // column's steps, each step one pass over each target column. Returns the
    // aggregated normalizationActions: [{ column, fn, count }] with count = cells
    // actually CHANGED (Object.is inequality), entries in first-touch order,
    // zero-count pairs omitted.
    function applyNormalization(rows, headers, norm, normFns, warn) {
        const actions = new Map();
        const bump = (column, fn, n) => {
            if (n === 0) return;
            const key = JSON.stringify([column, fn]);
            const a = actions.get(key);
            if (a) a.count += n;
            else actions.set(key, { column, fn, count: n });
        };
        let colCount = 0;
        for (const r of rows) colCount = Math.max(colCount, r.length);
        const labelOf = (c) => headers !== null && headers[c] !== undefined ? headers[c] : c;

        const contractFail = (fn, r, c) => new TableValidationIngestError('normalizationFunctionContractViolation',
            `Normalization function "${fn}" returned a non-scalar value at row ${r}, column ${c}`,
            { fn, row: r, column: c });

        const runStep = (stp, colIdx) => {
            const fn = stp.fn;
            const params = isObj(stp.params) ? stp.params : {};
            const builtin = NORMALIZATION_BUILTINS[fn];
            let changed = 0;
            const get = (r) => colIdx < rows[r].length ? rows[r][colIdx] : undefined;
            const set = (r, v) => {
                const t = typeof v;
                if (!(v === null || t === 'string' || t === 'boolean' || t === 'number')) throw contractFail(fn, r, colIdx);
                if (!Object.is(rows[r][colIdx], v)) { rows[r][colIdx] = v; changed++; }
            };
            if (builtin && builtin.pass) {
                builtin.pass(rows.length, get, set, builtin.prepare(params));
            } else {
                const ctx = builtin ? builtin.prepare(params) : null;
                const rawParams = stp.params !== undefined ? stp.params : null;
                const colName = headers !== null && isStr(headers[colIdx]) ? headers[colIdx] : null;
                for (let r = 0; r < rows.length; r++) {
                    if (colIdx >= rows[r].length) continue;
                    let out;
                    try {
                        out = builtin
                            ? builtin.cell(rows[r][colIdx], ctx)
                            : normFns[fn](rows[r][colIdx], { row: r, column: colIdx, columnName: colName }, rawParams);
                    } catch (e) {
                        if (e instanceof TableValidationConfigError) throw e;   // missing dependency global
                        throw new TableValidationIngestError('normalizationFunctionError',
                            `Normalization function "${fn}" threw at row ${r}, column ${colIdx}: ${e && e.message ? e.message : String(e)}`,
                            { fn, row: r, column: colIdx });
                    }
                    set(r, out);
                }
            }
            bump(labelOf(colIdx), fn, changed);
        };

        for (const stp of (norm.table || [])) {
            for (let c = 0; c < colCount; c++) runStep(stp, c);
        }
        if (isObj(norm.columns)) {
            for (const key of Object.keys(norm.columns)) {
                let targets;
                if (headers === null) {
                    const pos = parseInt(key, 10);
                    targets = pos < colCount ? [pos] : [];
                } else {
                    targets = [];
                    for (let c = 0; c < headers.length; c++) if (headers[c] === key) targets.push(c);
                }
                if (targets.length === 0) {
                    warn.add('irrelevantIngestSetting',
                        `normalization.columns[${JSON.stringify(key)}] matches no ingested column`, null, null);
                    continue;
                }
                for (const stp of norm.columns[key]) {
                    for (const c of targets) runStep(stp, c);
                }
            }
        }
        return Array.from(actions.values());
    }


    // IngestSpec validation (rules I1–I12) + defaults (Addendum §B.9). Collects ALL violations.
    function prepareIngestSpec(spec, normFns) {
        const errs = [];
        const bad = (path, expected, actual) => errs.push({ path, expected, actual });

        for (const k of Object.keys(spec)) {                                          // I11
            if (!INGEST_TOP_KEYS.includes(k)) bad(k, 'a known IngestSpec key', k);
        }
        for (const sub of Object.keys(INGEST_SUB_KEYS)) {
            if (isObj(spec[sub])) {
                for (const k of Object.keys(spec[sub])) {
                    if (!INGEST_SUB_KEYS[sub].includes(k)) bad(`${sub}.${k}`, `a known ${sub} key`, k);
                }
            } else if (spec[sub] !== undefined && sub !== 'normalization') {
                bad(sub, 'object', spec[sub]);
            }
        }
        const fmt = spec.format;
        if (!INGEST_FORMATS.includes(fmt)) bad('format', `one of ${INGEST_FORMATS.join(', ')}`, fmt);   // I1

        const h = isObj(spec.header) ? spec.header : {};
        if (h.mode !== undefined && !['firstRow', 'none', 'explicit'].includes(h.mode)) {              // I2
            bad('header.mode', '"firstRow", "none", or "explicit"', h.mode);
        }
        if (h.mode === 'explicit') {                                                                    // I3
            if (!(Array.isArray(h.names) && h.names.length > 0 && h.names.every(isStr))) {
                bad('header.names', 'non-empty string array (required with mode "explicit")', h.names);
            }
        } else if (h.names !== undefined && h.names !== null) {
            bad('header.names', 'absent or null unless header.mode is "explicit"', h.names);
        }

        const cs = isObj(spec.csv) ? spec.csv : {};
        if (cs.delimiter !== undefined && !(isStr(cs.delimiter) && cs.delimiter.length === 1)) {       // I4
            bad('csv.delimiter', 'exactly one character', cs.delimiter);
        }
        if (cs.quote !== undefined && !(isStr(cs.quote) && cs.quote.length === 1)) {
            bad('csv.quote', 'exactly one character', cs.quote);
        }
        if (cs.encoding !== undefined && !(isStr(cs.encoding) && cs.encoding.length > 0)) {            // I5
            bad('csv.encoding', '"auto" or a non-empty charset label', cs.encoding);
        }
        const xs = isObj(spec.xlsx) ? spec.xlsx : {};
        if (xs.sheet !== undefined && !((isStr(xs.sheet) && xs.sheet.length > 0) || isNonNegInt(xs.sheet))) {  // I6
            bad('xlsx.sheet', 'non-empty sheet name or non-negative integer index', xs.sheet);
        }
        const lm = isObj(spec.limits) ? spec.limits : {};
        for (const k of Object.keys(INGEST_LIMIT_DEFAULTS)) {                                          // I7
            if (lm[k] !== undefined && lm[k] !== null && !(isIntN(lm[k]) && lm[k] >= 1)) {
                bad(`limits.${k}`, 'positive integer or null', lm[k]);
            }
        }
        for (const k of ['skipRows', 'skipFooterRows']) {                                              // I13
            if (spec[k] !== undefined && !isNonNegInt(spec[k])) {
                bad(k, 'non-negative integer', spec[k]);
            }
        }
        // resolved spec (defaults per §B.9); delimiter/quote conflict checked on the resolved pair (I4)
        const resolved = {
            format: fmt,
            header: {
                mode: h.mode !== undefined ? h.mode : (fmt === 'jsonArrays' ? 'none' : 'firstRow'),
                names: h.names !== undefined ? h.names : null,
            },
            csv: {
                delimiter: fmt === 'tsv' ? '\t' : (cs.delimiter !== undefined ? cs.delimiter : ','),
                quote: cs.quote !== undefined ? cs.quote : '"',
                encoding: cs.encoding !== undefined ? cs.encoding : 'auto',
            },
            xlsx: { sheet: xs.sheet !== undefined ? xs.sheet : 0 },
            skipRows: isNonNegInt(spec.skipRows) ? spec.skipRows : 0,
            skipFooterRows: isNonNegInt(spec.skipFooterRows) ? spec.skipFooterRows : 0,
            limits: {},
            normalization: spec.normalization !== undefined ? spec.normalization : null,
        };
        for (const k of Object.keys(INGEST_LIMIT_DEFAULTS)) {
            resolved.limits[k] = lm[k] !== undefined ? lm[k] : INGEST_LIMIT_DEFAULTS[k];
        }
        if ((fmt === 'csv' || fmt === 'tsv') && resolved.csv.delimiter === resolved.csv.quote) {
            bad('csv.quote', 'a character different from the delimiter', resolved.csv.quote);
        }
        if (resolved.normalization !== null) {                                                 // I8–I10
            const headerless = resolved.header.mode === 'none' && fmt !== 'jsonObjects';
            checkNormalizationSpec(resolved.normalization, headerless, normFns || {}, bad);
        }
        if (errs.length) {
            throw new TableValidationIngestError('ingestSpecInvalid',
                `IngestSpec is invalid: ${errs.map((e) => e.path).join(', ')}`, errs);
        }
        return resolved;
    }

    // Warning collector — collapses repeated same-code/same-column warnings (Addendum §B.7)
    function makeWarnCollector() {
        const byKey = new Map();
        return {
            add(code, message, row, column) {
                const key = `${code}|${column === null || column === undefined ? '' : column}`;
                const w = byKey.get(key);
                if (w) { w.count++; return; }
                byKey.set(key, {
                    code, message,
                    row: row === undefined ? null : row,
                    column: column === undefined ? null : column,
                    count: 1,
                });
            },
            list() { return Array.from(byKey.values()); },
            shiftRows(delta) {   // header extraction: parse-row → data-row coordinates
                for (const w of byKey.values()) {
                    if (w.row !== null) w.row = w.row + delta < 0 ? null : w.row + delta;
                }
            },
        };
    }

    // Encoding chain (Addendum §B.5, JS spec §4.8): explicit label, or the closed
    // deterministic chain BOM → strict UTF-8 → windows-1252. Never any other heuristic.
    function decodeCsvBytes(u8, encSetting, warn) {
        const strict = (label) => new TextDecoder(label, { fatal: true });
        if (encSetting !== 'auto') {
            let dec;
            try { dec = strict(encSetting); } catch (_) {
                throw new TableValidationIngestError('encodingUnsupported',
                    `Encoding label "${encSetting}" is not supported by this environment's decoder`);
            }
            try { return { text: dec.decode(u8), encodingUsed: dec.encoding }; } catch (_) {
                throw new TableValidationIngestError('decodingFailed',
                    `Input bytes are not valid ${encSetting} (explicit encodings never fall back)`);
            }
        }
        const bomOf = () => {
            if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) return 'utf-8';
            if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) return 'utf-16le';
            if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) return 'utf-16be';
            return null;
        };
        const bom = bomOf();
        if (bom) {
            try { return { text: strict(bom).decode(u8), encodingUsed: bom }; } catch (_) {
                throw new TableValidationIngestError('decodingFailed',
                    `A ${bom} BOM is present but the bytes are not valid ${bom}`);
            }
        }
        try { return { text: strict('utf-8').decode(u8), encodingUsed: 'utf-8' }; } catch (_) {
            warn.add('encodingFallback', 'Input is not valid UTF-8; decoded as windows-1252 (the single defined fallback)', null, null);
            return { text: new TextDecoder('windows-1252').decode(u8), encodingUsed: 'windows-1252' };
        }
    }

    // CSV/TSV parser (Addendum §B.3 grammar: RFC 4180 + configurable delimiter/quote;
    // CRLF/LF/CR record separators, mixed allowed; whole-field quoting; doubled-quote escape).
    function parseCsvText(text, delim, quote) {
        const rows = [];
        let row = [], field = '', inQ = false;
        let i = 0;
        const n = text.length;
        while (i < n) {
            const ch = text[i];
            if (inQ) {
                if (ch === quote) {
                    if (text[i + 1] === quote) { field += quote; i += 2; } else { inQ = false; i++; }
                } else { field += ch; i++; }
            } else if (ch === quote && field === '') {
                inQ = true; i++;
            } else if (ch === delim) {
                row.push(field); field = ''; i++;
            } else if (ch === '\r' || ch === '\n') {
                row.push(field); rows.push(row); row = []; field = '';
                i += (ch === '\r' && text[i + 1] === '\n') ? 2 : 1;
            } else {
                field += ch; i++;
            }
        }
        // EOF: emit the pending record iff it carries content (a trailing record
        // separator does not produce a final empty row — Addendum §B.3 rule 5)
        if (field !== '' || row.length > 0 || inQ) { row.push(field); rows.push(row); }
        return rows;
    }

    // XLSX cell → Core §1.5 scalar (Addendum §B.3 mapping table, first match wins)
    function mapXlsxCell(cell, r0, c0, warn, mergedSeen) {
        if (cell.isMerged && cell.master && cell.master !== cell) {
            const key = cell.master.address || `${r0}:${c0}`;
            if (!mergedSeen.has(key)) {
                mergedSeen.add(key);
                warn.add('mergedCell', 'Merged range: non-master cells emitted as null', r0, c0);
            }
            return null;
        }
        let v = cell.value;
        if (v === null || v === undefined) return null;
        if (isObj(v) && (v.formula !== undefined || v.sharedFormula !== undefined)) {
            if (v.result === undefined || v.result === null) {
                warn.add('formulaNoCachedResult', 'Formula cell without a cached result emitted as null', r0, c0);
                return null;
            }
            v = v.result;
        }
        if (isObj(v) && v.error !== undefined) {
            warn.add('errorCell', 'Spreadsheet error value emitted as its code string', r0, c0);
            return String(v.error);
        }
        if (isObj(v) && Array.isArray(v.richText)) return v.richText.map((t) => (t && t.text) || '').join('');
        if (isObj(v) && (v.text !== undefined || v.hyperlink !== undefined)) {
            const t = v.text !== undefined && v.text !== null ? v.text : v.hyperlink;
            return isStr(t) ? t : canonical(t);
        }
        if (v instanceof Date) return isoFromUtcDate(v);
        if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
        return canonical(v);
    }

    // Deterministic zone-less ISO rendering of a workbook temporal value (Addendum §B.3):
    // yyyy-MM-dd at exact midnight, else yyyy-MM-dd'T'HH:mm:ss(.SSS when ms ≠ 0).
    function isoFromUtcDate(d) {
        const date = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
        const h = d.getUTCHours(), mi = d.getUTCMinutes(), s = d.getUTCSeconds(), ms = d.getUTCMilliseconds();
        if (h === 0 && mi === 0 && s === 0 && ms === 0) return date;
        let t = `${date}T${pad(h, 2)}:${pad(mi, 2)}:${pad(s, 2)}`;
        if (ms !== 0) t += '.' + pad(ms, 3);
        return t;
    }

    // Trailing all-null rows/columns are dropped (reader over-reporting); interior kept.
    function dropTrailingNulls(rows) {
        while (rows.length && rows[rows.length - 1].every((c) => c === null)) rows.pop();
        let width = 0;
        for (const r of rows) width = Math.max(width, r.length);
        let last = -1;
        for (let c = 0; c < width; c++) {
            for (const r of rows) if (c < r.length && r[c] !== null) { last = c; break; }
        }
        for (let i = 0; i < rows.length; i++) rows[i] = rows[i].slice(0, last + 1);
        return rows;
    }

    async function parseXlsxBytes(bytes, rs, warn) {
        const ExcelJS = global.ExcelJS;
        if (!ExcelJS) {
            throw new TableValidationConfigError('The ExcelJS global is required for XLSX ingestion but is not loaded.');
        }
        const wb = new ExcelJS.Workbook();
        try { await wb.xlsx.load(bytes); } catch (_) {
            throw new TableValidationIngestError('formatMismatch', 'The bytes are not a readable XLSX workbook');
        }
        let ws;
        if (typeof rs.xlsx.sheet === 'number') ws = wb.worksheets[rs.xlsx.sheet];
        else ws = wb.getWorksheet(rs.xlsx.sheet);
        if (!ws) {
            throw new TableValidationIngestError('sheetNotFound',
                `Sheet ${JSON.stringify(rs.xlsx.sheet)} does not exist in the workbook`,
                { available: wb.worksheets.map((w) => w.name) });
        }
        const rows = [];
        const mergedSeen = new Set();
        const rowN = ws.rowCount, colN = ws.columnCount;
        for (let r = 1; r <= rowN; r++) {
            const wsRow = ws.getRow(r);
            const out = [];
            for (let c = 1; c <= colN; c++) out.push(mapXlsxCell(wsRow.getCell(c), r - 1, c - 1, warn, mergedSeen));
            rows.push(out);
        }
        dropTrailingNulls(rows);
        return { rows, sheetName: ws.name };
    }

    function parseJsonSource(source, fmt) {
        let v = source;
        if (isStr(v)) {
            try { v = JSON.parse(v); } catch (_) {
                throw new TableValidationIngestError('formatMismatch', 'Source string is not valid JSON text');
            }
        }
        if (!Array.isArray(v)) {
            throw new TableValidationIngestError('formatMismatch', `A ${fmt} source must be a JSON array`);
        }
        if (fmt === 'jsonArrays') {
            const rows = [];
            for (let i = 0; i < v.length; i++) {
                if (!Array.isArray(v[i])) {
                    throw new TableValidationIngestError('formatMismatch', `jsonArrays: row ${i} is not an array`);
                }
                rows.push(v[i].map((c) => (c === undefined ? null : jsonClone(c))));
            }
            return { rows, headers: null };
        }
        const headers = [];
        const seen = new Set();
        for (let i = 0; i < v.length; i++) {
            if (!isObj(v[i])) {
                throw new TableValidationIngestError('formatMismatch', `jsonObjects: record ${i} is not a plain object`);
            }
            for (const k of Object.keys(v[i])) if (!seen.has(k)) { seen.add(k); headers.push(k); }
        }
        const rows = v.map((rec) => headers.map((k) => (k in rec && rec[k] !== undefined ? jsonClone(rec[k]) : null)));
        return { rows, headers };
    }

    // ingest() — the third building block (Addendum §B.1): source → TableInput +
    // provenance + warnings (+ normalizationActions when a pipeline ran). No validation
    // of any kind; always asynchronous (JS spec §3.12).
    async function ingest(source, ingestSpec, options) {
        if (!isObj(ingestSpec)) throw new TableValidationConfigError('ingestSpec must be a plain object');
        const opt = options === undefined || options === null ? {} : options;
        if (!isObj(opt)) throw new TableValidationConfigError('ingest options must be an object');
        let normFns = {};
        if (opt.normalizationFunctions !== undefined && opt.normalizationFunctions !== null) {
            if (!isObj(opt.normalizationFunctions)) {
                throw new TableValidationConfigError('options.normalizationFunctions must be an object of functions');
            }
            normFns = opt.normalizationFunctions;
        }
        const rs = prepareIngestSpec(ingestSpec, normFns);  // throws ingestSpecInvalid
        const fmt = rs.format;
        const warn = makeWarnCollector();

        // Sub-objects irrelevant to the chosen format are legal but inert (Addendum §B.2)
        if (fmt === 'xlsx' && ingestSpec.csv !== undefined) {
            warn.add('irrelevantIngestSetting', 'csv settings have no effect for format "xlsx"', null, null);
        }
        if ((fmt === 'csv' || fmt === 'tsv' || fmt === 'jsonArrays' || fmt === 'jsonObjects') && ingestSpec.xlsx !== undefined) {
            warn.add('irrelevantIngestSetting', `xlsx settings have no effect for format "${fmt}"`, null, null);
        }
        if (fmt === 'tsv' && isObj(ingestSpec.csv) && ingestSpec.csv.delimiter !== undefined) {
            warn.add('irrelevantIngestSetting', 'csv.delimiter has no effect for format "tsv" (delimiter is fixed to TAB)', null, null);
        }
        if (fmt === 'jsonObjects' && ingestSpec.header !== undefined) {                       // I12
            warn.add('irrelevantIngestSetting', 'header settings have no effect for format "jsonObjects" (headers are intrinsic)', null, null);
        }
        if ((fmt === 'jsonArrays' || fmt === 'jsonObjects') && ingestSpec.csv !== undefined) {
            warn.add('irrelevantIngestSetting', `csv settings have no effect for format "${fmt}"`, null, null);
        }

        // ---- source resolution
        let bytes = null, text = null, jsonVal;
        if (typeof Blob !== 'undefined' && source instanceof Blob) {
            if (rs.limits.maxBytes !== null && source.size > rs.limits.maxBytes) {
                throw new TableValidationIngestError('limitExceeded:maxBytes',
                    `Source is ${source.size} bytes; limits.maxBytes is ${rs.limits.maxBytes}`);
            }
            let buf;
            try { buf = await source.arrayBuffer(); } catch (_) {
                throw new TableValidationIngestError('sourceUnreadable', 'The source Blob/File could not be read');
            }
            bytes = new Uint8Array(buf);
        } else if (source instanceof ArrayBuffer) {
            bytes = new Uint8Array(source);
        } else if (ArrayBuffer.isView(source)) {
            bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
        } else if (typeof source === 'string') {
            text = source;
        } else if (Array.isArray(source)) {
            jsonVal = source;
        } else {
            throw new TableValidationConfigError(
                'ingest source must be a string, ArrayBuffer, Uint8Array, Blob/File, or (for JSON formats) an array');
        }
        if (bytes !== null && rs.limits.maxBytes !== null && bytes.byteLength > rs.limits.maxBytes) {
            throw new TableValidationIngestError('limitExceeded:maxBytes',
                `Source is ${bytes.byteLength} bytes; limits.maxBytes is ${rs.limits.maxBytes}`);
        }

        // ---- format routing
        let rawRows, intrinsicHeaders = null, sheetName = null, encodingUsed = null;
        if (fmt === 'csv' || fmt === 'tsv') {
            if (jsonVal !== undefined) throw new TableValidationConfigError(`an array source is not valid for format "${fmt}"`);
            if (bytes !== null) {
                const dec = decodeCsvBytes(bytes, rs.csv.encoding, warn);
                text = dec.text;
                encodingUsed = dec.encodingUsed;
            } else if (text !== null && text.charCodeAt(0) === 0xFEFF) {
                text = text.slice(1);       // already-decoded text: strip a leading BOM character
            }
            rawRows = parseCsvText(text, rs.csv.delimiter, rs.csv.quote);
        } else if (fmt === 'xlsx') {
            if (bytes === null) throw new TableValidationConfigError('an XLSX source must be bytes (ArrayBuffer, Uint8Array, or Blob/File)');
            const x = await parseXlsxBytes(bytes, rs, warn);
            rawRows = x.rows;
            sheetName = x.sheetName;
        } else {
            const src = jsonVal !== undefined ? jsonVal : text;
            if (src === null || src === undefined) {
                throw new TableValidationConfigError(`a ${fmt} source must be a JSON string or an array`);
            }
            const j = parseJsonSource(src, fmt);
            rawRows = j.rows;
            intrinsicHeaders = j.headers;
        }

        // ---- skipRows (Addendum §B.4): drop N leading PARSED rows before header handling
        // (report titles / metadata blocks above the real header)
        let skippedRows = 0;
        if (rs.skipRows > 0) {
            skippedRows = Math.min(rs.skipRows, rawRows.length);
            rawRows = rawRows.slice(skippedRows);
            warn.shiftRows(-skippedRows);
        }

        // ---- header handling (Addendum §B.4)
        let headers, rows = rawRows, headerMode;
        if (fmt === 'jsonObjects') {
            headers = intrinsicHeaders;
            headerMode = 'intrinsic';
        } else if (rs.header.mode === 'firstRow') {
            headerMode = 'firstRow';
            headers = rows.length ? rows[0].map((c) => (c === null || c === undefined ? '' : canonical(c))) : [];
            rows = rows.slice(1);
            warn.shiftRows(-1);
        } else if (rs.header.mode === 'explicit') {
            headerMode = 'explicit';
            headers = rs.header.names.slice();
        } else {
            headerMode = 'none';
            headers = null;
        }

        // ---- skipFooterRows (Addendum §B.4): drop N trailing data rows (totals/footers)
        let skippedFooterRows = 0;
        if (rs.skipFooterRows > 0) {
            skippedFooterRows = Math.min(rs.skipFooterRows, rows.length);
            rows = rows.slice(0, rows.length - skippedFooterRows);
        }

        // ---- limits (Addendum §B.6): defined failure, never silent truncation
        const rowCount = rows.length;
        let columnCount = 0, cellCount = 0;
        for (const r of rows) { columnCount = Math.max(columnCount, r.length); cellCount += r.length; }
        if (rs.limits.maxRows !== null && rowCount > rs.limits.maxRows) {
            throw new TableValidationIngestError('limitExceeded:maxRows',
                `${rowCount} data rows; limits.maxRows is ${rs.limits.maxRows}`);
        }
        if (rs.limits.maxColumns !== null && columnCount > rs.limits.maxColumns) {
            throw new TableValidationIngestError('limitExceeded:maxColumns',
                `${columnCount} columns; limits.maxColumns is ${rs.limits.maxColumns}`);
        }
        if (rs.limits.maxCells !== null && cellCount > rs.limits.maxCells) {
            throw new TableValidationIngestError('limitExceeded:maxCells',
                `${cellCount} cells; limits.maxCells is ${rs.limits.maxCells}`);
        }

        // ---- normalization (Addendum §B.8): opt-in transform stage between the raw
        // parse (headers already extracted — never normalized) and the emitted TableInput
        let normalizationActions;
        if (rs.normalization !== null) {
            normalizationActions = applyNormalization(rows, headers, rs.normalization, normFns, warn);
        }

        const result = {
            table: { headers, rows },
            source: {
                format: fmt,
                encodingUsed,
                delimiter: fmt === 'csv' || fmt === 'tsv' ? rs.csv.delimiter : null,
                sheetName,
                rowCount,
                columnCount,
                headerMode,
                skippedRows,
                skippedFooterRows,
            },
            warnings: warn.list(),
        };
        if (normalizationActions !== undefined) result.normalizationActions = normalizationActions;
        return result;
    }

    // ================================================================
    // Addendum §C — Configuration inference (JS spec §3.13)
    // ================================================================

    // Fixed candidate null tokens (Addendum §C.3) — adopted per column on observation
    const INFER_NULL_TOKENS = ['NA', 'N/A', 'null', 'NULL', '-'];

    // Fixed candidate NumberFormats, tried in order (Addendum §C.4 step 4). Candidates
    // 6–10 (1.2.0) are 1–5 with allowBareDecimal — appended AFTER every strict candidate
    // so the tightest accepted format wins; bare variants only win when a participant
    // actually lacks the integer part (".85").
    const INFER_NUMBER_FORMATS_STRICT = [
        { decimalSeparator: '.', groupingSeparators: [','] },
        { decimalSeparator: ',', groupingSeparators: ['.'] },
        { decimalSeparator: ',', groupingSeparators: [' '] },
        { decimalSeparator: '.', groupingSeparators: [' '] },
        { decimalSeparator: '.', groupingSeparators: ["'"] },
    ];
    const INFER_NUMBER_FORMATS = INFER_NUMBER_FORMATS_STRICT.concat(
        INFER_NUMBER_FORMATS_STRICT.map((f) => Object.assign({}, f, { allowBareDecimal: true })));

    // Fixed temporal candidate tables, tried date → time → datetime (Addendum §C.4 step 5).
    // The 1.1.0 additions are appended after every 1.0.0 candidate so no 1.0.0 winner moves.
    const INFER_TEMPORAL_TABLES = [
        // 1.2.0: full mixed-padding families (d.MM.yyyy etc.) appended after every earlier
        // candidate; the family reduction below — not table position — decides among
        // same-family accepters, so no earlier winner moves.
        { type: 'date', formats: ['yyyy-MM-dd', 'dd.MM.yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyyMMdd', 'dd-MM-yyyy', 'yyyy/MM/dd', 'd.M.yyyy', 'd/M/yyyy', 'M/d/yyyy',
            'd.MM.yyyy', 'dd.M.yyyy', 'd/MM/yyyy', 'dd/M/yyyy', 'M/dd/yyyy', 'MM/d/yyyy', 'd-MM-yyyy', 'dd-M-yyyy', 'd-M-yyyy', 'yyyy-M-d', 'yyyy/M/d'] },
        { type: 'time', formats: ['HH:mm:ss', 'HH:mm', 'HH:mm:ss.SSS'] },
        { type: 'datetime', formats: ["yyyy-MM-dd'T'HH:mm:ss", 'yyyy-MM-dd HH:mm:ss', "yyyy-MM-dd'T'HH:mm:ss.SSS", "yyyy-MM-dd'T'HH:mm:ssZZ", "yyyy-MM-dd'T'HH:mm:ss.SSSZZ", 'dd.MM.yyyy HH:mm:ss', 'dd.MM.yyyy HH:mm', 'dd/MM/yyyy HH:mm', 'MM/dd/yyyy HH:mm'] },
    ];

    // §C.4 candidate families (1.1.0 twins, generalized in 1.2.0): candidates identical
    // after full unpadding form a family; within one, X GENERALIZES Y iff X's day/month
    // tokens accept a superset (d ⊇ dd, M ⊇ MM). The accepting/used sets are reduced
    // before winner/ambiguity logic: equal accepted sets → drop the generalization (the
    // tightest description of the evidence wins); strict subset → drop the subset member.
    const inferUnpad = (f) => f.split('dd').join('d').split('MM').join('M');
    const inferDayLen = (f) => (f.includes('dd') ? 2 : 1);
    const inferMonthLen = (f) => (f.includes('MM') ? 2 : 1);
    function inferGeneralizes(x, y) {
        if (x === y || inferUnpad(x) !== inferUnpad(y)) return false;
        const dx = inferDayLen(x), dy = inferDayLen(y), mx = inferMonthLen(x), my = inferMonthLen(y);
        return dx <= dy && mx <= my && (dx < dy || mx < my);
    }

    // Inference-only well-formed-grouping acceptance (Addendum §C.4 step 4): grouping
    // separators must partition the integer part into a 1–3 digit lead + exactly-3-digit
    // groups. Without this, "01.07.2026" would read as the int 1072026 under a
    // dot-grouping candidate and dates could never reach ladder step 5. The engines'
    // §3.5 acceptance stays lenient — this guard applies to inference only.
    const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const INFER_FMT_RES = INFER_NUMBER_FORMATS.map((f) => {
        const g = escRe(f.groupingSeparators[0]);
        const d = escRe(f.decimalSeparator);
        // bare-decimal candidates (§C.4, 1.2.0): also accept D-digits with no integer
        // part — never with grouping (nothing to group without an integer part)
        const bare = f.allowBareDecimal ? `|${d}[0-9]+` : '';
        return new RegExp(`^[+-]?(?:(?:[0-9]+|[0-9]{1,3}(?:${g}[0-9]{3})+)(?:${d}[0-9]+)?${bare})$`);
    });

    function inferInterpretNumber(str, fmtIndex) {
        if (!INFER_FMT_RES[fmtIndex].test(str)) return null;
        return interpretNumberFormat(str, INFER_NUMBER_FORMATS[fmtIndex], false);
    }

    const INFER_BOOL_STRAT = { caseSensitive: false, trim: true, stripSpaces: false };
    const INFER_TRUE = ['true', '1', 'yes'];
    const INFER_FALSE = ['false', '0', 'no'];
    const INFER_NONNUMERIC_BOOL = ['true', 'false', 'yes', 'no'];

    const interpKeyOf = (v) => (v === null ? 'null' : `${typeof v}:${canonical(v)}`);

    // Infer one column from its sampled cells. Returns the per-column report record
    // plus the drafted type block. Deterministic by construction (Addendum §C.9).
    function inferColumn(cells, lux, allAcceptingFormats) {
        // §C.3 null recognition: intrinsic (native null, "") + adopted candidate tokens
        const nullTokensSeen = {};
        for (const t of INFER_NULL_TOKENS) {
            let n = 0;
            for (const c of cells) if (c === t) n++;
            if (n > 0) nullTokensSeen[t] = n;
        }
        const adopted = new Set(Object.keys(nullTokensSeen));
        const isNullCell = (c) => c === null || c === '' || (isStr(c) && adopted.has(c));
        const participants = cells.filter((c) => !isNullCell(c));
        const nulls = cells.length - participants.length;

        const col = {
            adoptedTokens: INFER_NULL_TOKENS.filter((t) => adopted.has(t)),
            nullTokensSeen,
            participants: participants.length,
            nulls,
            nullable: nulls > 0,
            type: 'string', formats: null, allowedValues: null,
            confidence: 'high', reasons: [], alternatives: [],
            interpreted: null,       // interpreted participant values (for distinct/min/max/keys)
            min: null, max: null, minPrecision: null, maxPrecision: null,
            relied: false,
        };

        if (participants.length === 0) {
            col.confidence = 'fallback';
            col.reasons = ['allNull'];
            col.nullable = true;
            col.interpreted = [];
            col.distinctCount = 0;
            return col;
        }

        const hasStringP = participants.some((p) => isStr(p));
        const finish = (type, interpreted, extra) => {
            col.type = type;
            col.interpreted = interpreted;
            const keys = new Set(interpreted.map(interpKeyOf));
            col.distinctCount = keys.size;
            col.relied = ['bool', 'int', 'float', 'datetime', 'date', 'time'].includes(type) && hasStringP;
            Object.assign(col, extra || {});
            return col;
        };
        const numericMinMax = (values) => {
            let mn = values[0], mx = values[0];
            for (const v of values) { if (v < mn) mn = v; if (v > mx) mx = v; }
            return { min: mn, max: mx };
        };

        // ---- ladder step 1: bool
        {
            let allBool = true, hasNonNumericToken = false;
            const T = INFER_TRUE.map((s) => applyStrategy(s, INFER_BOOL_STRAT));
            const F = INFER_FALSE.map((s) => applyStrategy(s, INFER_BOOL_STRAT));
            const interp = [];
            for (const p of participants) {
                if (typeof p === 'boolean') { hasNonNumericToken = true; interp.push(p); continue; }
                if (isStr(p)) {
                    const n = applyStrategy(p, INFER_BOOL_STRAT);
                    if (T.includes(n)) { interp.push(true); if (INFER_NONNUMERIC_BOOL.includes(n)) hasNonNumericToken = true; continue; }
                    if (F.includes(n)) { interp.push(false); if (INFER_NONNUMERIC_BOOL.includes(n)) hasNonNumericToken = true; continue; }
                }
                allBool = false;
                break;
            }
            if (allBool && hasNonNumericToken) return finish('bool', interp);
            // numeric-only bool reading ("0"/"1" columns): proceed down the ladder, but
            // remember the bool reading as the ranked alternative (Addendum §C.4 step 1)
            col._numericBoolAlt = allBool && !hasNonNumericToken;
        }

        // ---- step 2: int (direct strict parse)
        {
            let ok = true;
            const values = [];
            for (const p of participants) {
                if (isNum(p) && Number.isInteger(p) && Number.isSafeInteger(p)) { values.push(p); continue; }
                if (isStr(p) && INT_RE.test(p) && Number.isSafeInteger(Number(p))) { values.push(Number(p)); continue; }
                ok = false;
                break;
            }
            if (ok) {
                const mm = numericMinMax(values);
                const extra = { min: mm.min, max: mm.max, minPrecision: 0, maxPrecision: 0 };
                if (col._numericBoolAlt) {
                    extra.confidence = 'ambiguous';
                    extra.reasons = ['numericStringBoolAlternative'];
                    extra.alternatives = [{ type: 'bool', formats: null, rank: 1 }];
                } else if (lux && participants.every((p) => {
                    // §C.4 digit-date guard (1.1.0): an 8-digit column that fully parses as
                    // yyyyMMdd stays int (conservative ladder order) but carries the date
                    // reading as the rank-1 alternative — never swallowed silently again
                    const s = isStr(p) ? p : canonical(p);
                    return /^[0-9]{8}$/.test(s) && lux.DateTime.fromFormat(s, 'yyyyMMdd', { zone: 'utc' }).isValid;
                })) {
                    extra.confidence = 'ambiguous';
                    extra.reasons = ['digitDate'];
                    extra.alternatives = [{ type: 'date', formats: ['yyyyMMdd'], rank: 1 }];
                }
                return finish('int', values, extra);
            }
        }

        // ---- step 3: float (direct strict parse)
        {
            let ok = true;
            const values = [], precs = [];
            for (const p of participants) {
                if (isNum(p)) { values.push(p); precs.push(floatPrecisionOfCanonical(p)); continue; }
                if (isStr(p) && FLOAT_RE.test(p)) {
                    values.push(Number(p));
                    const dot = p.indexOf('.');
                    precs.push(dot === -1 ? 0 : p.length - dot - 1);
                    continue;
                }
                ok = false;
                break;
            }
            if (ok) {
                const mm = numericMinMax(values);
                const pm = numericMinMax(precs);
                return finish('float', values, {
                    min: mm.min, max: mm.max,
                    minPrecision: pm.min, maxPrecision: pm.max,
                });
            }
        }

        // ---- step 4: formatted number (fixed candidate NumberFormats, first full acceptance;
        // well-formed grouping required — see inferInterpretNumber above)
        {
            let winner = null, values = null, precs = null, allInt = true;
            for (let fi = 0; fi < INFER_NUMBER_FORMATS.length; fi++) {
                let ok = true;
                const vs = [], ps = [];
                let ints = true;
                for (const p of participants) {
                    if (isNum(p)) {
                        vs.push(p); ps.push(floatPrecisionOfCanonical(p));
                        if (!Number.isInteger(p) || !Number.isSafeInteger(p) || floatPrecisionOfCanonical(p) > 0) ints = false;
                        continue;
                    }
                    if (!isStr(p)) { ok = false; break; }
                    const r = inferInterpretNumber(p, fi);
                    if (!r) { ok = false; break; }
                    vs.push(r.value); ps.push(r.precision);
                    if (r.precision > 0 || !Number.isInteger(r.value) || !Number.isSafeInteger(r.value)) ints = false;
                }
                if (ok) { winner = INFER_NUMBER_FORMATS[fi]; values = vs; precs = ps; allInt = ints; break; }
            }
            if (winner) {
                const mm = numericMinMax(values);
                const pm = numericMinMax(precs);
                return finish(allInt ? 'int' : 'float', values, {
                    formats: [jsonClone(winner)],
                    min: mm.min, max: mm.max,
                    minPrecision: pm.min, maxPrecision: pm.max,
                });
            }
        }

        // ---- step 5: temporal (requires the Luxon binding; skipped — and reported — without it)
        if (lux && participants.every(isStr)) {
            // parse cache: each (value, format) pair hits Luxon once — this is what makes
            // exhaustive mode (§C.2, 1.2.0) affordable on low-cardinality columns
            const vcache = new Map();
            const valid = (pv, f) => {
                const k = f + ' ' + pv;
                let r = vcache.get(k);
                if (r === undefined) { r = lux.DateTime.fromFormat(pv, f, { zone: 'utc' }).isValid; vcache.set(k, r); }
                return r;
            };
            for (const table of INFER_TEMPORAL_TABLES) {
                // family reduction, full-acceptance path: all accepters accept everything,
                // so accepted sets are equal → drop every generalization (§C.4, 1.2.0)
                const accepting = table.formats.filter((f) => participants.every((pv) => valid(pv, f)))
                    .filter((f, _, arr) => !arr.some((y) => inferGeneralizes(f, y)));
                if (accepting.length > 0) {
                    const winnerFmt = accepting[0];
                    const millis = participants.map((pv) => lux.DateTime.fromFormat(pv, winnerFmt, { zone: 'utc' }).toMillis());
                    let mnI = 0, mxI = 0;
                    for (let i = 1; i < millis.length; i++) {
                        if (millis[i] < millis[mnI]) mnI = i;
                        if (millis[i] > millis[mxI]) mxI = i;
                    }
                    // allAcceptingFormats (§C.4): the draft carries every accepting candidate,
                    // winner first (candidate-table order thereafter), instead of the winner only
                    const extra = {
                        formats: allAcceptingFormats ? accepting.slice() : [winnerFmt],
                        min: participants[mnI], max: participants[mxI],
                    };
                    if (accepting.length > 1) {
                        extra.confidence = 'ambiguous';
                        extra.reasons = ['multipleTemporalFormats'];
                        extra.alternatives = accepting.slice(1).map((f, i) => ({ type: table.type, formats: [f], rank: i + 1 }));
                    }
                    return finish(table.type, millis, extra);
                }
                // allAcceptingFormats union coverage (§C.4): no single candidate accepts every
                // participant, but the table's candidates JOINTLY cover them all → the column is
                // a mixed-format temporal; the draft carries every candidate that accepts at
                // least one participant, winner (most participants; tie → table order) first.
                if (allAcceptingFormats) {
                    // family reduction, union path (§C.4, 1.2.0): within a family the
                    // generalization's accepted set is a structural superset, so size
                    // comparison is exact — a generalization adding nothing is dropped
                    // (tightest wins), a member strictly weaker than its generalization
                    // is dropped (it contributes nothing the generalization lacks)
                    const nAccepted = (f) => participants.reduce((n, pv) => n + (valid(pv, f) ? 1 : 0), 0);
                    const used = table.formats.filter((f) => participants.some((pv) => valid(pv, f)))
                        .filter((f, _, arr) => !arr.some((o) =>
                            (inferGeneralizes(f, o) && nAccepted(f) === nAccepted(o)) ||
                            (inferGeneralizes(o, f) && nAccepted(f) < nAccepted(o))));
                    if (used.length > 1 && participants.every((pv) => used.some((f) => valid(pv, f)))) {
                        const acceptCount = new Map(used.map((f) => [f, participants.filter((pv) => valid(pv, f)).length]));
                        const winner = used.reduce((w, f) => acceptCount.get(f) > acceptCount.get(w) ? f : w, used[0]);
                        const formats = [winner].concat(used.filter((f) => f !== winner));
                        // interpret each participant with its FIRST accepting format in draft
                        // order — exactly the engine's formats-tried-in-order semantics
                        const millis = participants.map((pv) => {
                            const f = formats.find((ff) => valid(pv, ff));
                            return lux.DateTime.fromFormat(pv, f, { zone: 'utc' }).toMillis();
                        });
                        let mnI = 0, mxI = 0;
                        for (let i = 1; i < millis.length; i++) {
                            if (millis[i] < millis[mnI]) mnI = i;
                            if (millis[i] > millis[mxI]) mxI = i;
                        }
                        return finish(table.type, millis, {
                            formats,
                            min: participants[mnI], max: participants[mxI],
                            confidence: 'ambiguous',
                            reasons: ['mixedTemporalFormats'],
                            alternatives: formats.slice(1).map((f, i) => ({ type: table.type, formats: [f], rank: i + 1 })),
                        });
                    }
                }
            }
        }

        // ---- step 6: categorical (string-resident; fixed thresholds — Addendum §C.5)
        if (participants.every(isStr)) {
            const distinct = Array.from(new Set(participants));
            if (participants.length >= 20 && distinct.length <= 12 && distinct.length / participants.length <= 0.1) {
                distinct.sort(cpCompare);
                return finish('categorical', participants.slice(), { allowedValues: distinct });
            }
        }

        // ---- step 7: string fallback
        const kinds = new Set(participants.map((p) => (isStr(p) ? 'string' : typeof p === 'object' ? 'object' : typeof p)));
        const extra = {};
        if (!(kinds.size === 1 && kinds.has('string'))) {
            extra.confidence = 'fallback';
            extra.reasons = kinds.size > 1 || kinds.has('object') ? ['mixedNativeKinds'] : [];
        }
        return finish('string', participants.map((p) => (isStr(p) ? p : canonical(p))), extra);
    }

    function inferConfig(table, options) {
        // --- caller errors (thrown; the draft itself is never "invalid data")
        if (!isObj(table)) throw new TableValidationConfigError('table must be a TableInput object');
        const headers = table.headers === undefined ? null : table.headers;
        if (headers !== null && !(Array.isArray(headers) && headers.every(isStr))) {
            throw new TableValidationConfigError('table.headers must be an array of strings or null');
        }
        const rows = table.rows;
        if (!Array.isArray(rows) || rows.some((r) => !Array.isArray(r))) {
            throw new TableValidationConfigError('table.rows must be an array of arrays');
        }
        const o = options === undefined || options === null ? {} : options;
        if (!isObj(o)) throw new TableValidationConfigError('options must be an object');
        const sampleRows = o.sampleRows !== undefined ? o.sampleRows : 1000;                       // N2
        if (!(isIntN(sampleRows) && sampleRows >= 1)) {
            throw new TableValidationConfigError('options.sampleRows must be an integer >= 1');
        }
        const name = o.name !== undefined ? o.name : 'inferred-config';                            // N3
        if (!isStr(name) || name.length === 0) {
            throw new TableValidationConfigError('options.name must be a non-empty string');
        }
        for (const k of ['suggestRanges', 'suggestPrecision', 'seedComparison', 'allAcceptingFormats', 'exhaustive']) {
            if (o[k] !== undefined && !isBool(o[k])) throw new TableValidationConfigError(`options.${k} must be a boolean`);
        }
        const suggestRanges = o.suggestRanges === true;
        const suggestPrecision = o.suggestPrecision !== false;                                     // §C.10: default true (1.1.0)
        const seedComparison = o.seedComparison === true;
        const allAcceptingFormats = o.allAcceptingFormats === true;
        const exhaustive = o.exhaustive === true;                                                  // §C.2 (1.2.0)

        // column count: headers when present, else the widest row of the WHOLE table (§C.7)
        const colCount = headers !== null ? headers.length
            : rows.reduce((m, r) => Math.max(m, r.length), 0);
        if (colCount === 0) {
            throw new TableValidationConfigError('cannot infer a config from a table with no columns');
        }

        const lux = global.luxon || null;
        const limitations = [];
        if (!lux) limitations.push('temporalDisabled:luxon');

        // byName only when the headers are usable as schema column keys: non-empty and
        // collision-free under the default fieldNameMatching (Core rule 41); otherwise the
        // draft falls back to byPosition so it stays meta-schema-valid (rule N1).
        let useByName = headers !== null && headers.length > 0;
        if (useByName) {
            const seen = new Set();
            for (const h of headers) {
                const norm = applyStrategy(h, DEF_SMS_LOOSE);
                if (h.length === 0 || seen.has(norm)) { useByName = false; break; }
                seen.add(norm);
            }
            if (!useByName) limitations.push('headersUnusable:byPosition');
        }
        const colNames = [];
        for (let i = 0; i < colCount; i++) colNames.push(useByName ? headers[i] : `col_${i}`);

        const sample = exhaustive ? rows : rows.slice(0, Math.min(sampleRows, rows.length));   // §C.2 exhaustive (1.2.0)

        // ---- per-column inference
        const colReports = [];
        const draftCols = {};
        const adoptedUnion = new Set();
        const candidateKeys = [];
        const tolerances = [];

        for (let i = 0; i < colCount; i++) {
            const cells = sample.map((r) => (i < r.length ? (r[i] === undefined ? null : r[i]) : null));
            const c = inferColumn(cells, lux, allAcceptingFormats);
            for (const t of c.adoptedTokens) adoptedUnion.add(t);
            const candidateKey = c.nulls === 0 && c.participants > 0 && c.distinctCount === c.participants;
            if (candidateKey) candidateKeys.push(colNames[i]);

            const typeBlock = { name: c.type };
            if (TEMPORAL[c.type]) typeBlock.formats = c.formats.slice();
            else if (c.formats) typeBlock.formats = jsonClone(c.formats);
            if (c.type === 'categorical') {
                typeBlock.allowedValues = c.allowedValues.slice();
                typeBlock.typeStrict = false;
            }
            if (suggestRanges && (c.type === 'int' || c.type === 'float') && c.min !== null) {
                typeBlock.value = { min: c.min, max: c.max, minInclusive: true, maxInclusive: true };
            }
            // §C.7 (1.1.0): precision decoupled from value ranges — decimal places are
            // contract-like (default on), observed min/max values usually are not (default off)
            if (suggestPrecision && c.type === 'float' && c.minPrecision !== null) {
                typeBlock.precision = { min: c.minPrecision, max: c.maxPrecision, minInclusive: true, maxInclusive: true };
            }
            draftCols[colNames[i]] = { nullable: c.nullable, type: typeBlock };

            if (c.type === 'float' && c.maxPrecision !== null) {
                tolerances.push({
                    column: colNames[i],
                    suggested: 0.5 * Math.pow(10, -c.maxPrecision),
                    basis: `observedPrecision:${c.maxPrecision}`,
                });
            }
            colReports.push({
                name: colNames[i],
                inferredType: c.type,
                confidence: c.confidence,
                reasons: c.reasons,
                alternatives: c.alternatives,
                observed: {
                    participants: c.participants,
                    nulls: c.nulls,
                    distinctCount: c.distinctCount,
                    nullTokensSeen: c.nullTokensSeen,
                    min: c.min, max: c.max,
                    minPrecision: c.minPrecision, maxPrecision: c.maxPrecision,
                    reliedOnInterpretation: c.relied,
                },
                candidateKey,
                sampleDerivedNullability: exhaustive ? false : c.nulls === 0,   // exhaustive: a whole-table fact (§C.2)
            });
        }

        // ---- draft assembly (Addendum §C.7 — and nothing else, rule N4)
        const strictType = !colReports.some((r) => r.observed.reliedOnInterpretation);
        const nullEquivalents = [''].concat(INFER_NULL_TOKENS.filter((t) => adoptedUnion.has(t)));
        const draft = {
            meta: {
                schemaVersion: '1.2.0',
                name,
                description: 'Draft inferred from sample data; review before use.',
            },
            nullHandling: { nullEquivalents },
            evaluation: { strictType, timezone: 'utc' },
            structure: {
                columnMatching: useByName ? 'byName' : 'byPosition',
                columnCount: { min: colCount, max: colCount, minInclusive: true, maxInclusive: true },
            },
            columns: draftCols,
        };
        if (seedComparison && candidateKeys.length > 0) {
            draft.comparison = { match: { keys: [candidateKeys[0]] } };
        }

        return {
            draft: canonicalizeConfig(draft),
            report: {
                sample: { rowsAvailable: rows.length, rowsSampled: sample.length, exhaustive },
                columns: colReports,
                candidateKeys,
                noSingleColumnKey: candidateKeys.length === 0,
                suggestions: { tolerances },
                limitations,
            },
        };
    }

    // ================================================================
    // Global assembly — exactly one global
    // ================================================================

    const TableValidation = {
        VERSION,
        SPEC_VERSION,
        validate,
        compare,
        buildReport,
        renderMessage: (ruleName, context, templates) => renderMessage(ruleName, context || {}, templates),
        exportXlsx,
        exportComparisonXlsx,
        exportAnnotatedXlsx,
        adapters: { fromArrays, fromObjects },
        // Tooling modules (Addendum §A–§C; JS spec §3.11–§3.13)
        configModel,
        createConfigBuilder,
        ingest,
        normalizationModel,
        inferConfig,
        TableValidationConfigError,
        TableValidationIngestError,
    };

    global.TableValidation = TableValidation;

})(globalThis);
