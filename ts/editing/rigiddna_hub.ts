/**
 * The rigidDNA window: one window with a tab for rigidDNA (1), one for rigidDNA2 and one for rigidRNA.
 * Tab 1 (windows/rigidDNAWindow.html, rigiddna_ui.ts) relaxes a structure already loaded in the viewer;
 * tab 2 (rigiddna2_ui.ts) computes the relaxed structure of a caDNAno / scadnano / oxDNA design in the browser;
 * tab 3 (rigidrna_ui.ts) computes the oxRNA2 structure of an RNA sequence + dot-bracket (rigidRNA, optionally with salt-dependent electrostatics).
 */

/** Tab shown when the window is created (rigidDnaOpen asks for it before the window exists). */
let rigidDnaHubPending: 1 | 2 | 3 = 1;
let rigidDnaHubTab: 1 | 2 | 3 = 1;

/** oncreate callback of view.createWindow('rigidDNAWindow', ...): sets up both tabs. */
function initRigidDnaHub() {
    initRigidDnaWindow();
    initRigidDna2Window();
    initRigidRnaWindow();
    rigidDnaShowTab(rigidDnaHubPending);
}

/** Shows one tab of the rigidDNA window. */
function rigidDnaShowTab(tab: 1 | 2 | 3) {
    rigidDnaHubTab = tab;
    for (const t of [1, 2, 3]) {
        const pane = document.getElementById(`rdPane${t}`);
        const btn = document.getElementById(`rdTabBtn${t}`);
        if (pane) pane.style.display = t === tab ? '' : 'none';
        if (btn) btn.classList.toggle('rd-active', t === tab);
    }
    try { localStorage.setItem('rigidDnaTab', String(tab)); } catch (e) { /* storage may be blocked */ }
}

/**
 * Ribbon buttons: opens the rigidDNA window on the given tab; a second click on the button of the tab being shown closes the window.
 */
function rigidDnaOpen(tab: 1 | 2 | 3) {
    const w = document.getElementById('rigidDNAWindow');
    if (!w) {
        rigidDnaHubPending = tab;
        view.createWindow('rigidDNAWindow', initRigidDnaHub);
        return;
    }
    if (rigidDnaHubTab === tab) {
        Metro.window.toggle(w);
    } else {
        Metro.window.show(w);
        rigidDnaShowTab(tab);
    }
}
