/* Authoring & Run Console — DOM helpers, §A.2 predicate evaluator, and the
 * descriptor-driven SettingField kit (UI arch §1 principle 3, §5 SettingField).
 * All settings forms render from TableValidation.configModel — there is no
 * hand-maintained settings list in this console. */
'use strict';
(function (global) {
    const NS = global.TVConsole = global.TVConsole || {};
    const TV = () => global.TableValidation;

    // ---------------- DOM ----------------

    function h(tag, attrs, ...children) {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (v === undefined || v === null || v === false) continue;
            if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
            else if (k === 'class') el.className = v;
            else if (k === 'checked') el.checked = !!v;
            else if (k === 'value') el.value = v;
            else if (k === 'disabled') el.disabled = true;
            else el.setAttribute(k, v === true ? '' : String(v));
        }
        const add = (c) => {
            if (c === null || c === undefined || c === false) return;
            if (Array.isArray(c)) { c.forEach(add); return; }
            el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
        };
        children.forEach(add);
        return el;
    }
    NS.h = h;

    NS.jstr = (v) => v === undefined ? '' : JSON.stringify(v);

    // ---------------- predicate evaluator (Addendum §A.2 grammar) ----------------
    // Evaluated over the RESOLVED PREVIEW (defaults applied), so a predicate over an
    // absent optional setting reads its default; `#effective` also reads the preview
    // (override resolution has already happened there).

    const SENTINEL = String.fromCharCode(0);
    function readPath(preview, path, colName) {
        let p = path.replace(/#effective$/, '');
        p = p.replace(/<name>|<col>/g, colName === null || colName === undefined ? SENTINEL : colName);
        if (p.includes(SENTINEL)) return undefined;
        let node = preview;
        for (const raw of p.split('.')) {
            const m = /^([^[\]]+)(\[(\d+)\])?$/.exec(raw);
            if (!m || node === null || typeof node !== 'object') return undefined;
            node = node[m[1]];
            if (m[3] !== undefined) node = Array.isArray(node) ? node[+m[3]] : undefined;
            if (node === undefined) return undefined;
        }
        return node;
    }

    function evalPredicate(pred, preview, colName) {
        if (!pred) return true;
        if (pred.all) return pred.all.every((p) => evalPredicate(p, preview, colName));
        if (pred.any) return pred.any.some((p) => evalPredicate(p, preview, colName));
        if (pred.not) return !evalPredicate(pred.not, preview, colName);
        const v = readPath(preview, pred.path, colName);
        switch (pred.op) {
            case 'eq': return JSON.stringify(v) === JSON.stringify(pred.value);
            case 'neq': return JSON.stringify(v) !== JSON.stringify(pred.value);
            case 'in': return (pred.value || []).some((x) => JSON.stringify(x) === JSON.stringify(v));
            case 'notIn': return !(pred.value || []).some((x) => JSON.stringify(x) === JSON.stringify(v));
            case 'null': return v === null || v === undefined;
            case 'nonNull': return v !== null && v !== undefined;
            default: return true;
        }
    }
    NS.evalPredicate = evalPredicate;

    function predicateText(pred) {
        if (!pred) return '';
        if (pred.all) return pred.all.map(predicateText).join(' and ');
        if (pred.any) return pred.any.map(predicateText).join(' or ');
        if (pred.not) return 'not (' + predicateText(pred.not) + ')';
        const tail = pred.path.split('.').slice(-2).join('.');
        if (pred.op === 'null') return `${tail} is unset`;
        if (pred.op === 'nonNull') return `${tail} is set`;
        return `${tail} ${pred.op} ${JSON.stringify(pred.value)}`;
    }

    // ---------------- descriptor lookup ----------------

    const modelIndex = { byPath: null };
    function descriptors() {
        if (!modelIndex.byPath) {
            modelIndex.byPath = new Map();
            for (const s of TV().configModel.settings) {
                const key = s.path + '|' + s.section;
                modelIndex.byPath.set(key, s);
                if (!modelIndex.byPath.has(s.path)) modelIndex.byPath.set(s.path, s);
            }
        }
        return modelIndex.byPath;
    }
    NS.descriptor = (path, section) => descriptors().get(section ? path + '|' + section : path) || descriptors().get(path);
    NS.sectionDescriptors = (section) => TV().configModel.settings.filter((s) => s.section === section);

    // ---------------- value parsing per descriptor type ----------------

    function parseScalar(text, kind) {
        const t = text.trim();
        if (t === '') return undefined;                       // unset → engine default (sparse authoring)
        if (kind === 'int' || kind === 'number') {
            const n = Number(t);
            return Number.isNaN(n) ? t : n;                   // let Phase 1 flag a non-number
        }
        return t;
    }

    // ---------------- SettingField (UI arch §5) ----------------
    // ctx: { get(path), edit(path, value), preview, colName, colPath(path) }
    // Renders one descriptor as a labeled control. `relevantWhen === false` on the
    // resolved preview dims the field and states the reason (the irrelevantSetting
    // logic in machine form). Empty input = "unset" = engine default (sparse authoring).

    function field(desc, ctx, concretePath) {
        const path = concretePath || (ctx.colPath ? ctx.colPath(desc.path) : desc.path);
        const cur = ctx.get(path);
        const relevant = evalPredicate(desc.relevantWhen, ctx.preview, ctx.colName);
        const commit = (value) => ctx.edit(path, value);

        let control;
        const t = desc.type;
        if (t === 'enum' || t === 'Severity' && !isObjectValue(cur)) {
            const opts = t === 'Severity' ? ['error', 'warning'] : (desc.enum || []);
            control = h('select', { onchange: (e) => commit(e.target.value === '' ? undefined : e.target.value) },
                h('option', { value: '', selected: cur === undefined }, `(default: ${NS.jstr(desc.default)})`),
                opts.map((o) => h('option', { value: o, selected: cur === o }, String(o))));
        } else if (t === 'bool' || t === 'bool|null') {
            control = h('select', { onchange: (e) => commit(e.target.value === '' ? undefined : e.target.value === 'true') },
                h('option', { value: '', selected: cur === undefined || cur === null }, `(default: ${NS.jstr(desc.default)})`),
                h('option', { value: 'true', selected: cur === true }, 'true'),
                h('option', { value: 'false', selected: cur === false }, 'false'));
        } else if (t === 'int' || t === 'number' || t === 'int|null' || t === 'number|null') {
            control = h('input', {
                type: 'text', value: cur === undefined || cur === null ? '' : String(cur),
                placeholder: `default: ${NS.jstr(desc.default)}`,
                onchange: (e) => commit(parseScalar(e.target.value, 'number')),
            });
        } else if (t === 'string' || t === 'string|null' || t === '"first"|"last"|int') {
            control = h('input', {
                type: 'text', value: cur === undefined || cur === null ? '' : String(cur),
                placeholder: desc.required ? '(required)' : `default: ${NS.jstr(desc.default)}`,
                onchange: (e) => {
                    let v = parseScalar(e.target.value, 'string');
                    if (t === '"first"|"last"|int' && v !== undefined && /^-?\d+$/.test(v)) v = parseInt(v, 10);
                    commit(v);
                },
            });
        } else if (t === 'StringMatchStrategy') {
            control = smsControl(cur, desc, commit);
        } else if (t === 'Range' || t === 'Range|null') {
            control = rangeControl(cur, desc, commit);
        } else if (t === 'NumberFormat[]|null') {
            // JSON chip editor + example-to-format compiler: type an example value, see
            // the compiled parametric format(s), append explicitly — never silently
            control = h('span', {}, jsonControl(cur, desc, commit),
                exampleCompiler(() => ctx.get(path), commit));
        } else {
            // arrays, maps, spec objects, Severity object form → JSON input (unambiguous)
            control = jsonControl(cur, desc, commit);
        }

        // a11y: associate the label with the field's first focusable control
        const fid = 'f_' + path.replace(/[^\w]/g, '_');
        const target = control.matches && control.matches('input,select') ? control
            : control.querySelector ? control.querySelector('input,select') : null;
        if (target) target.id = fid;
        const wrap = h('div', { class: 'field' + (relevant ? '' : ' irrelevant') },
            h('label', { for: target ? fid : undefined, title: `${path} — ${desc.doc.description}` },
                desc.doc.label, desc.required ? h('span', { class: 'req' }, ' *') : null),
            control,
            !relevant ? h('div', { class: 'hint' }, `no effect: ${predicateText(desc.relevantWhen)} is false`) : null);
        return wrap;
    }
    NS.field = field;

    const isObjectValue = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

    // ---------------- example → NumberFormat compiler (UI sugar; schema stays parametric) ----------------
    // Deterministic reading of one example value. Returns { formats: [...], note } —
    // TWO formats when the example is genuinely ambiguous ("1.234": decimal vs grouped
    // integer) so the user picks; the compiled JSON is always shown before committing.
    function compileNumberExample(raw) {
        let s = String(raw).trim();
        if (!s) return { error: 'type an example value first' };
        let negativeStyle = null;
        if (/^\(.*\)$/.test(s)) { negativeStyle = 'parentheses'; s = s.slice(1, -1); }
        else if (s.length > 1 && s.endsWith('-')) { negativeStyle = 'trailingMinus'; s = s.slice(0, -1); }
        else if (/^[+-]/.test(s)) s = s.slice(1);
        const seps = Array.from(new Set(s.replace(/[0-9]/g, '').split('')));
        if (seps.some((c) => /[+\-0-9]/.test(c))) return { error: 'signs may only lead (or trail as a minus)' };
        if (seps.length > 2) return { error: `too many separator characters (${seps.join(' ')})` };
        const mk = (ds, gs, extra) => {
            const f = { decimalSeparator: ds, groupingSeparators: gs };
            if (extra) Object.assign(f, extra);
            if (negativeStyle) f.negativeStyle = negativeStyle;
            return f;
        };
        const groupsOk = (str, g) => {
            const parts = str.split(g);
            return parts.length >= 2 && parts.every((p) => /^[0-9]+$/.test(p)) &&
                parts[0].length >= 1 && parts[0].length <= 3 &&
                parts.slice(1).every((p) => p.length === 3);
        };
        if (seps.length === 0) {
            if (!/^[0-9]+$/.test(s)) return { error: 'unreadable example' };
            return { formats: [mk('.', [])], note: 'plain integer example — dot decimal assumed' };
        }
        if (seps.length === 2) {
            // the separator whose LAST occurrence comes later is the decimal; it must occur once
            const [a, b] = seps;
            const dsChar = s.lastIndexOf(a) > s.lastIndexOf(b) ? a : b;
            const gsChar = dsChar === a ? b : a;
            if (s.split(dsChar).length !== 2) return { error: `"${dsChar}" occurs more than once — cannot be the decimal separator` };
            const intPart = s.slice(0, s.lastIndexOf(dsChar));
            if (!groupsOk(intPart, gsChar)) return { error: `"${gsChar}" does not group digits in threes` };
            return { formats: [mk(dsChar, [gsChar])] };
        }
        const c = seps[0];
        const n = s.split(c).length - 1;
        if (n > 1) {
            if (!groupsOk(s, c)) return { error: `"${c}" repeats but does not group digits in threes` };
            return { formats: [mk(null, [c])], note: 'grouping-only (integer) reading' };
        }
        const tail = s.slice(s.indexOf(c) + 1);
        const head = s.slice(0, s.indexOf(c));
        if (head === '') {
            return { formats: [mk(c, [], { allowBareDecimal: true })], note: 'bare decimal — allowBareDecimal set' };
        }
        if (tail.length === 3 && head.length >= 1 && head.length <= 3) {
            // the classic ambiguity: decimal vs thousands — offer BOTH, user picks
            return {
                formats: [mk(c, []), mk(c === '.' ? ',' : '.', [c])],
                ambiguous: true,
                note: `"${s}" reads as a decimal OR a grouped integer — pick the intended one`,
            };
        }
        return { formats: [mk(c, [])] };
    }
    NS.compileNumberExample = compileNumberExample;

    function exampleCompiler(getCur, commit) {
        const input = h('input', { type: 'text', class: 'narrow', placeholder: 'e.g. (1 234,50)' });
        const out = h('span', { class: 'hint' });
        const render = () => {
            const r = compileNumberExample(input.value);
            out.textContent = '';
            if (r.error) { out.textContent = r.error; return; }
            if (r.note) out.append(r.note + ' ');
            for (const f of r.formats) {
                const label = JSON.stringify(f);
                out.append(h('button', {
                    class: 'mini', title: 'append this format to the formats array',
                    onclick: () => {
                        const cur = getCur();
                        commit((Array.isArray(cur) ? cur : []).concat([f]));
                        input.value = '';
                        out.textContent = 'added ' + label;
                    },
                }, '+ ' + label));
            }
        };
        input.addEventListener('input', render);
        return h('span', { class: 'fmt-example' }, ' from example: ', input, ' ', out);
    }

    function smsControl(cur, desc, commit) {
        const val = isObjectValue(cur) ? cur : null;
        const def = desc.default || { caseSensitive: false, trim: true, stripSpaces: false };
        const boxes = {};
        const emit = () => {
            if (!boxes._on.checked) { commit(undefined); return; }
            commit({ caseSensitive: boxes.caseSensitive.checked, trim: boxes.trim.checked, stripSpaces: boxes.stripSpaces.checked });
        };
        boxes._on = h('input', { type: 'checkbox', checked: !!val, onchange: emit });
        for (const k of ['caseSensitive', 'trim', 'stripSpaces']) {
            boxes[k] = h('input', { type: 'checkbox', checked: val ? !!val[k] : !!def[k], onchange: emit });
        }
        return h('span', { class: 'sms' },
            h('label', { class: 'inline' }, boxes._on, 'set'),
            h('label', { class: 'inline' }, boxes.caseSensitive, 'caseSensitive'),
            h('label', { class: 'inline' }, boxes.trim, 'trim'),
            h('label', { class: 'inline' }, boxes.stripSpaces, 'stripSpaces'));
    }

    function rangeControl(cur, desc, commit) {
        const val = isObjectValue(cur) ? cur : null;
        const parts = {};
        const emit = () => {
            const minT = parts.min.value.trim(), maxT = parts.max.value.trim();
            if (minT === '' && maxT === '') { commit(undefined); return; }
            const num = (s) => s === '' ? null : (/^[+-]?\d+(\.\d+)?$/.test(s) ? Number(s) : s);
            commit({ min: num(minT), max: num(maxT), minInclusive: parts.minInc.checked, maxInclusive: parts.maxInc.checked });
        };
        parts.min = h('input', { type: 'text', class: 'narrow', placeholder: 'min', value: val && val.min !== null && val.min !== undefined ? String(val.min) : '', onchange: emit });
        parts.max = h('input', { type: 'text', class: 'narrow', placeholder: 'max', value: val && val.max !== null && val.max !== undefined ? String(val.max) : '', onchange: emit });
        parts.minInc = h('input', { type: 'checkbox', checked: val ? !!val.minInclusive : true, onchange: emit });
        parts.maxInc = h('input', { type: 'checkbox', checked: val ? !!val.maxInclusive : true, onchange: emit });
        return h('span', { class: 'range' },
            parts.min, h('label', { class: 'inline' }, parts.minInc, '≤'), '…',
            h('label', { class: 'inline' }, parts.maxInc, '≤'), parts.max,
            h('button', { class: 'mini', onclick: () => { parts.min.value = ''; parts.max.value = ''; emit(); } }, 'clear'));
    }

    function jsonControl(cur, desc, commit) {
        const input = h('input', {
            type: 'text', class: 'json',
            value: cur === undefined ? '' : JSON.stringify(cur),
            placeholder: desc.required ? `(required, JSON — e.g. ${NS.jstr(desc.default) || '[]'})` : `JSON; default: ${NS.jstr(desc.default)}`,
        });
        const err = h('span', { class: 'field-err' });
        input.addEventListener('change', () => {
            const t = input.value.trim();
            err.textContent = '';
            if (t === '') { commit(undefined); return; }
            try { commit(JSON.parse(t)); } catch (_) { err.textContent = 'not valid JSON'; }
        });
        return h('span', {}, input, err);
    }

    // Render every descriptor of a section (table-level settings groups)
    NS.sectionFields = function (section, ctx, opts) {
        const skip = (opts && opts.skip) || [];
        const out = [];
        for (const d of NS.sectionDescriptors(section)) {
            if (skip.includes(d.path)) continue;
            if (d.path.includes('<rule>')) {
                for (const rule of ['columnCountBreach', 'extraColumn', 'columnOrderViolation', 'rowCountBreach', 'allNullRow', 'duplicateRow', 'duplicateColumnName']) {
                    const dd = Object.assign({}, d, { doc: { label: `severities.${rule}`, description: d.doc.description } });
                    out.push(field(dd, ctx, d.path.replace('<rule>', rule)));
                }
            } else {
                out.push(field(d, ctx));
            }
        }
        return out;
    };
})(globalThis);
