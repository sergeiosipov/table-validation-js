/* Authoring & Run Console — boot + render loop (UI arch §8: minimal store,
 * components re-invoked on change, no framework). */
'use strict';
(function (global) {
    const NS = global.TVConsole;
    const h = (...a) => NS.h(...a);

    // §5 polish: inline modal replacing prompt()/confirm()/alert()
    function dialogOverlay(store) {
        const d = store.state.ui.dialog;
        if (!d) return null;
        const input = d.kind === 'prompt' ? h('input', {
            type: 'text', value: d.value || '',
            oninput: (e) => store.dispatch.dialogSetValue(e.target.value),
            onkeydown: (e) => { if (e.key === 'Enter') store.dispatch.dialogOk(); },
        }) : null;
        return h('div', { class: 'dialog-backdrop', onclick: (e) => { if (e.target.classList.contains('dialog-backdrop')) store.dispatch.dialogCancel(); } },
            h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': d.title || 'dialog',
                onkeydown: (e) => { if (e.key === 'Escape') store.dispatch.dialogCancel(); } },
                h('h3', {}, d.title || ''),
                h('p', {}, d.text || ''),
                input,
                h('div', { class: 'dialog-btns' },
                    d.kind !== 'alert' ? h('button', { onclick: () => store.dispatch.dialogCancel() }, 'Cancel') : null,
                    h('button', { class: 'primary' + (d.danger ? ' danger' : ''), onclick: () => store.dispatch.dialogOk() },
                        d.okLabel || 'OK'))));
    }

    function render(storeRef) {
        const store = storeRef.store;
        const root = document.getElementById('app');
        const st = store.state;
        const panel = {
            data: NS.DataPanel,
            schema: NS.SchemaPanel,
            comparison: NS.ComparisonPanel,
            run: NS.RunTab,
        }[st.ui.activeTab] || NS.DataPanel;
        const next = h('div', {},
            NS.HeaderBar(store),
            NS.Rail(store),
            NS.Notices(store),
            panel(store),
            dialogOverlay(store));
        root.replaceChildren(next);
        const dlgInput = document.querySelector('.dialog input, .dialog button.primary');
        if (dlgInput) dlgInput.focus();
        // §6 errors→data cross-navigation: bring the flashed row into view after render
        const flash = document.getElementById('flash-row');
        if (flash) requestAnimationFrame(() => flash.scrollIntoView({ block: 'center' }));
    }

    global.addEventListener('load', () => {
        if (!global.TableValidation) {
            document.getElementById('app').textContent =
                'TableValidation failed to load — check that dist/table-validation.js is reachable.';
            return;
        }
        const storeRef = {};
        storeRef.store = NS.createStore(() => render(storeRef));
        render(storeRef);
        global.__tvconsole = storeRef.store;   // dev/testing handle
        // §7: nudge before losing unsaved authoring work (localStorage is a cache, not the copy)
        global.addEventListener('beforeunload', (e) => {
            if (storeRef.store.state.authoring.dirtySinceSave) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
    });
})(globalThis);
