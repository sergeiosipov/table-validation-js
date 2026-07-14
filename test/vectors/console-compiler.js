/* Console unit tests — the example→NumberFormat compiler (console/ui.js
 * `compileNumberExample`, UI arch §5 line 331: preview-before-commit, dual-reading
 * ambiguous compile). The function is a pure, DOM-free reading of one example string;
 * the harness loads console/ui.js (a globalThis IIFE) so `TVConsole.compileNumberExample`
 * is available headlessly. Values pinned here were OBSERVED from the live function.
 * Covers B033 (compiler had zero test coverage). */
'use strict';
(function () {
    const U = (name, fn, extra) => window.__UNIT__.push(Object.assign({ suite: 'console / compiler', name, fn }, extra));
    const C = () => window.TVConsole && window.TVConsole.compileNumberExample;

    U('compileNumberExample — is loaded DOM-free from console/ui.js', (t) => {
        t.assert(typeof C() === 'function', 'TVConsole.compileNumberExample present (console/ui.js loaded in the harness)');
    });

    U('compileNumberExample — plain integer assumes a dot decimal', (t) => {
        t.assertEq(C()('1234'), {
            formats: [{ decimalSeparator: '.', groupingSeparators: [] }],
            note: 'plain integer example — dot decimal assumed',
        }, 'plain int');
        // a leading sign is stripped and does not change the reading
        t.assertEq(C()('-1234').formats, [{ decimalSeparator: '.', groupingSeparators: [] }], 'leading minus stripped');
        t.assertEq(C()('+1234').formats, [{ decimalSeparator: '.', groupingSeparators: [] }], 'leading plus stripped');
    });

    U('compileNumberExample — genuinely ambiguous "1.234" offers BOTH readings (ambiguous:true)', (t) => {
        const r = C()('1.234');
        t.assertEq(r.ambiguous, true, 'flagged ambiguous');
        t.assertEq(r.formats, [
            { decimalSeparator: '.', groupingSeparators: [] },
            { decimalSeparator: ',', groupingSeparators: ['.'] },
        ], 'decimal reading then grouped-integer reading, in order');
        t.assertEq(r.note, '"1.234" reads as a decimal OR a grouped integer — pick the intended one', 'ambiguity note');
        // the mirror ambiguity, comma flavour
        t.assertEq(C()('1,234').formats, [
            { decimalSeparator: ',', groupingSeparators: [] },
            { decimalSeparator: '.', groupingSeparators: [','] },
        ], 'comma-flavour ambiguity');
        // NOT ambiguous once the integer part exceeds three digits (grouped reading impossible)
        const wide = C()('1234.567');
        t.assert(!wide.ambiguous, 'four-digit head is unambiguous');
        t.assertEq(wide.formats, [{ decimalSeparator: '.', groupingSeparators: [] }], 'single decimal reading');
    });

    U('compileNumberExample — two-separator European "1.234,50" is unambiguous', (t) => {
        t.assertEq(C()('1.234,50'), { formats: [{ decimalSeparator: ',', groupingSeparators: ['.'] }] }, 'euro grouping+decimal');
        t.assertEq(C()('1,234.50'), { formats: [{ decimalSeparator: '.', groupingSeparators: [','] }] }, 'us grouping+decimal');
        t.assertEq(C()("1'234.50"), { formats: [{ decimalSeparator: '.', groupingSeparators: ["'"] }] }, 'apostrophe grouping');
    });

    U('compileNumberExample — bare decimal ".85" sets allowBareDecimal', (t) => {
        t.assertEq(C()('.85'), {
            formats: [{ decimalSeparator: '.', groupingSeparators: [], allowBareDecimal: true }],
            note: 'bare decimal — allowBareDecimal set',
        }, 'dot bare decimal');
        t.assertEq(C()(',85').formats, [{ decimalSeparator: ',', groupingSeparators: [], allowBareDecimal: true }], 'comma bare decimal');
    });

    U('compileNumberExample — repeated single separator is a grouping-only integer', (t) => {
        t.assertEq(C()('1.234.567'), {
            formats: [{ decimalSeparator: null, groupingSeparators: ['.'] }],
            note: 'grouping-only (integer) reading',
        }, 'dot grouping-only');
        t.assertEq(C()('1,234,567').formats, [{ decimalSeparator: null, groupingSeparators: [','] }], 'comma grouping-only');
    });

    U('compileNumberExample — parentheses and trailing minus carry negativeStyle', (t) => {
        t.assertEq(C()('(1.234,50)'), {
            formats: [{ decimalSeparator: ',', groupingSeparators: ['.'], negativeStyle: 'parentheses' }],
        }, 'parentheses on a two-separator example');
        t.assertEq(C()('(1234)'), {
            formats: [{ decimalSeparator: '.', groupingSeparators: [], negativeStyle: 'parentheses' }],
            note: 'plain integer example — dot decimal assumed',
        }, 'parentheses on a plain integer');
        t.assertEq(C()('1.234,50-'), {
            formats: [{ decimalSeparator: ',', groupingSeparators: ['.'], negativeStyle: 'trailingMinus' }],
        }, 'trailing minus on a two-separator example');
    });

    U('compileNumberExample — error branches (empty, too many separators, mid-string sign)', (t) => {
        t.assertEq(C()(''), { error: 'type an example value first' }, 'empty input');
        t.assertEq(C()('   '), { error: 'type an example value first' }, 'whitespace-only input');
        t.assertEq(C()('1.234,567 89'), { error: 'too many separator characters (. ,  )' }, 'three distinct separators');
        t.assertEq(C()('1+2'), { error: 'signs may only lead (or trail as a minus)' }, 'plus in the middle');
        t.assertEq(C()('1,23.456'), { error: '"," does not group digits in threes' }, 'grouping not in threes');
        // no `formats` key on an error result, no `error` key on a success result
        t.assert(C()('1234').error === undefined, 'success carries no error key');
        t.assert(C()('').formats === undefined, 'error carries no formats key');
    });
})();
