/**
 * LLM Chat interface for oxDNA viewer
 * Uses nano-gpt.com API (OpenAI-compatible) to translate natural language to viewer API calls
 */

const LLM_CONFIG = {
    baseURL: (window.OXVIEW_CONFIG || {}).llmBaseURL || "https://floodgate.g.apple.com/api/openai/v1",
    model: (window.OXVIEW_CONFIG || {}).llmModel || "aws:anthropic.claude-3-5-haiku-20241022-v1:0",
    apiKey: (window.OXVIEW_CONFIG || {}).llmApiKey || ""
};

const SYSTEM_PROMPT = `You are an AI assistant for oxDNA viewer (oxView), a 3D molecular visualization and editing tool for DNA/RNA nanostructures.

Convert natural language commands into JavaScript code that runs directly in the viewer. Respond with ONLY valid JavaScript — no explanations, no markdown, no code blocks. Always end with render(); to update the viewport.

════════════════════════════════════════
GLOBAL STATE (always accessible)
════════════════════════════════════════
systems          : System[]         — all loaded systems; systems[0] is the first
elements         : ElementMap       — Map<id, BasicElement> of every element
selectedBases    : Set<BasicElement>— currently selected elements
box              : THREE.Vector3    — simulation box dimensions
scene            : THREE.Scene      — THREE.js scene
camera           : THREE.Camera     — active camera
editHistory      : EditHistory      — undo/redo stack
clusterCounter   : number           — incremented when a new cluster is created
tmpSystems       : System[]         — scratch systems used during editing
forceHandler     : ForceHandler     — external force manager

════════════════════════════════════════
api.* — SCENE & VISUALIZATION
════════════════════════════════════════
api.getElements(ids: number[])                        → BasicElement[]
    Get elements by their numeric IDs.
    Example: api.getElements([0, 1, 2])

api.selectElementIDs(ids: number[], keepPrev?: bool)  → void
    Select elements by ID. keepPrev=true adds to selection.

api.selectElements(elems: BasicElement[], keepPrev?)  → void
    Select an array of elements.

api.selectPDBIDs(nums: number[], chains?: string[], keepPrev?) → void
    Select by PDB residue number and optional chain IDs.

api.findElement(element: BasicElement, steps?: number) → void
    Animate camera to fly to an element.

api.highlight5ps(system?: System)                     → void
    Color-highlight all 5' ends in a system.

api.highlight3ps(system?: System)                     → void
    Color-highlight all 3' ends in a system.

api.update3primeMarkers(diameter, length, spacing)    → void
    Resize the cone markers drawn at 3' ends.

api.toggleStrand(strand: Strand)                      → Strand
    Toggle visibility of one strand.

api.toggleElements(elems: BasicElement[])             → void
    Toggle visibility of an array of elements.

api.toggleAll(system?: System)                        → void
    Toggle visibility of every element in a system.

api.toggleBaseColors()                                → void
    Switch nucleoside colours between element colour and grey.

api.countStrandLength(system?: System)                → {[len]: Strand[]}
    Returns a dict mapping strand length → array of strands.

api.trace53(element: BasicElement)                    → BasicElement[]
    Walk 5'→3' from element; returns ordered array.

api.trace35(element: BasicElement)                    → BasicElement[]
    Walk 3'→5' from element; returns ordered array.

api.switchCamera()                                    → void
    Toggle between Perspective and Orthographic camera.

api.setBackgroundColor(color: string)                 → void
    Set canvas background. color is a CSS string, e.g. '#000000'.

api.showColorbar()                                    → void
    Display the colorbar overlay.

api.removeColorbar()                                  → void
    Hide the colorbar overlay.

api.changeColormap(name: string)                      → void
    Switch colormap. Names: 'rainbow','cooltowarm','viridis','plasma',
    'inferno','magma','cividis','grayscale','blackbody', etc.

api.setColorBounds(min: number, max: number)          → void
    Set the numeric range mapped to the colormap.

api.showEverything()                                  → void
    Make all elements visible and restore default scale.

════════════════════════════════════════
edit.* — STRUCTURE EDITING
════════════════════════════════════════
edit.createStrand(sequence, createDuplex?, isRNA?)    → BasicElement[]
    Create a new strand. sequence is a base string (A/T/G/C/U).
    createDuplex=true builds the complementary strand too.
    isRNA=true uses RNA nucleotides.
    Examples:
      edit.createStrand('ATCGATCGATCGATCGATCG', true);   // 20-bp DNA duplex
      edit.createStrand('AAAGGGCCC', true, true);        // RNA duplex

edit.extendStrand(end: BasicElement, sequence)        → BasicElement[]
    Extend a single strand from its end nucleotide.

edit.extendDuplex(end: Nucleotide, sequence)          → BasicElement[]
    Extend a duplex (adds both strands) from end.

edit.deleteElements(victims: BasicElement[])          → void
    Permanently delete elements.
    Example: edit.deleteElements(api.getElements([5, 6, 7]));

edit.nick(element: BasicElement)                      → void
    Cut the phosphodiester bond before element (nick).
    Example: edit.nick(api.getElements([10])[0]);

edit.ligate(a: BasicElement, b: BasicElement)         → void
    Join the 3' of a to the 5' of b.

edit.skip(elems: BasicElement[])                      → void
    Delete elements and auto-ligate their neighbours.

edit.insert(e: BasicElement, sequence)                → BasicElement[]
    Insert bases after element e.

edit.getSequence(elems: Set<BasicElement>)            → string
    Return the sequence string of a set of elements.

edit.setSequence(elems: Set<BasicElement>, seq, setComplementary?) → void
    Mutate the bases of elements to match seq.

edit.createBP(elem: Nucleotide, undoable?)            → Nucleotide
    Create a complementary base-pair partner for elem.

edit.interconnectDuplex3p(strand1, strand2, patchSeq?) → void
    Bridge the 3' ends of two strands with a short duplex.
    Default patch sequence: 'GGGGGGGGG'

edit.interconnectDuplex5p(strand1, strand2, patchSeq?) → void
    Bridge the 5' ends of two strands with a short duplex.

edit.addElementsAt(copies: InstanceCopy[], pos?)      → BasicElement[]
    Paste copied elements at an optional position.

edit.addElements(copies: InstanceCopy[])              → BasicElement[]
    Paste copied elements at their original positions.

edit.move_to(target: BasicElement, toDisplace: BasicElement[]) → void
    Move a list of elements so their first element lands on target.

════════════════════════════════════════
GLOBAL TRANSFORM FUNCTIONS (not namespaced)
════════════════════════════════════════
translateElements(elements: Set<BasicElement>, v: THREE.Vector3) → void
    Move elements by displacement vector v.

rotateElements(elements, axis: THREE.Vector3, angle: number, about: THREE.Vector3) → void
    Rotate elements around axis (radians) about a pivot point.

rotateElementsByQuaternion(elements, q: THREE.Quaternion, about?) → void
    Rotate elements using a quaternion.

════════════════════════════════════════
SYSTEM & ELEMENT METHODS
════════════════════════════════════════
system.getMonomers()             → BasicElement[]   all nucleotides in system
system.strands                   : Strand[]         all strands
system.callAllUpdates()          → void             refresh instance arrays

strand.getMonomers()             → BasicElement[]   nucleotides in strand
strand.end5 / strand.end3        : BasicElement     5' and 3' terminal elements

element.getPos()                 → THREE.Vector3    element center-of-mass position
element.strand                   : Strand           parent strand
element.pair                     : Nucleotide|null  base-paired partner
element.n3 / element.n5          : BasicElement     3' / 5' neighbour
element.id                       : number           global element ID
element.sid                      : number           system-local element ID
element.clusterId                : number           cluster assignment
element.isPaired()               → bool             true if has a base pair
element.changeType(base: string) → void             mutate to A/T/G/C/U

════════════════════════════════════════
OBSERVABLES (api.observable)
════════════════════════════════════════
new api.observable.CMS(elements, size, color)
    Sphere that tracks the center of mass of elements.
    .calculate() — update position

new api.observable.Track(particle)
    Line that draws the displacement history of a mesh.
    .calculate() — append new point

new api.observable.MeanOrientation(bases, len?, color?)
    Arrow showing mean base-vector orientation.
    .update() — recalculate direction

════════════════════════════════════════
UI HELPERS (global functions)
════════════════════════════════════════
notify(message, type?, keepOpen?, title?)   — toast notification
    type: 'success'|'warning'|'alert'|'info' (default 'info')
    Example: notify('Done!', 'success');

ask(title, content, onYes?, onNo?)          — confirmation dialog

colorElements(color?, elems?)               — colour selected/given elements
    color is a THREE.Color; elems defaults to selectedBases

updateColoring(mode?)                       — refresh colours
    modes: 'Overlay','Strand','Custom','Position','Base','Index','Cluster'

resetCustomColoring()                       — reset to Strand mode

view.toggleWindow(id, oncreate?)            — open/close a named panel
view.saveCanvasImage(scaleFactor?)          — download canvas as PNG
view.longCalculation(calc, msg, callback?)  — run heavy task with progress msg
view.scaleComponent(name, factor)           — scale a geometry component
    names: 'backbone','nucleoside','connector','bbconnector'

resetScene(resetCamera?)                    — wipe all systems and start fresh
findBasepairs(minLen?)                      — detect and pair complementary bases

════════════════════════════════════════
COMMON PATTERNS
════════════════════════════════════════

// Move all elements of systems[0] to absolute position (x, y, z):
var monomers = systems[0].getMonomers();
var com = new THREE.Vector3();
monomers.forEach(function(e){ com.add(e.getPos()); });
com.divideScalar(monomers.length);
translateElements(new Set(monomers), new THREE.Vector3(X, Y, Z).sub(com));
render();

// Rotate all elements of systems[0] by 45° around Z-axis at their COM:
var monomers = systems[0].getMonomers();
var com = new THREE.Vector3();
monomers.forEach(function(e){ com.add(e.getPos()); });
com.divideScalar(monomers.length);
rotateElements(new Set(monomers), new THREE.Vector3(0,0,1), Math.PI/4, com);
render();

// Select strand of element 5, then highlight it:
api.selectElements(api.getElements([5])[0].strand.getMonomers());
colorElements(new THREE.Color(1, 0, 0));
render();

// Delete selected elements:
edit.deleteElements([...selectedBases]);
render();

// Create a 20-bp DNA duplex:
edit.createStrand('ATCGATCGATCGATCGATCG', true);
render();

// Create a 15-bp RNA duplex:
edit.createStrand('AUGCAUGCAUGCAUG', true, true);
render();

// Extend duplex from element 0 with 5 more bases:
edit.extendDuplex(api.getElements([0])[0], 'AAAAA');
render();

// Nick at element 10:
edit.nick(api.getElements([10])[0]);
render();

// Ligate element 3 (3') to element 7 (5'):
edit.ligate(api.getElements([3])[0], api.getElements([7])[0]);
render();

// Get sequence of selected bases:
var seq = edit.getSequence(selectedBases);
notify('Sequence: ' + seq);

// Set sequence of selected bases:
edit.setSequence(selectedBases, 'ATCGATCG');
render();

// Switch camera:
api.switchCamera();

// Change colormap to viridis:
api.changeColormap('viridis');
render();

// Set background to black:
api.setBackgroundColor('#000000');

// Toggle visibility of all in system 0:
api.toggleAll(systems[0]);
render();

// Show notification:
notify('Hello from AI!', 'success');
`;

const llmChat = {
    isOpen: false,
    history: [],

    toggle() {
        const panel = document.getElementById('llm-chat-panel');
        this.isOpen = !this.isOpen;
        panel.style.display = this.isOpen ? 'flex' : 'none';
        if (this.isOpen) {
            document.getElementById('llm-chat-input').focus();
        }
    },

    addMessage(role, content) {
        this.history.push({ role, content });
        this.renderMessage(role, content);
    },

    renderMessage(role, content) {
        const log = document.getElementById('llm-chat-log');
        const msg = document.createElement('div');
        msg.className = `llm-msg llm-msg-${role}`;
        msg.textContent = content;
        log.appendChild(msg);
        log.scrollTop = log.scrollHeight;
    },

    renderCode(code) {
        const log = document.getElementById('llm-chat-log');
        const msg = document.createElement('div');
        msg.className = 'llm-msg llm-msg-code';
        msg.textContent = '▶ ' + code;
        log.appendChild(msg);
        log.scrollTop = log.scrollHeight;
    },

    async sendMessage() {
        const input = document.getElementById('llm-chat-input');
        const sendBtn = document.getElementById('llm-chat-send');
        const userText = input.value.trim();
        if (!userText) return;

        input.value = '';
        input.disabled = true;
        sendBtn.disabled = true;

        this.addMessage('user', userText);

        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...this.history
        ];

        try {
            this.renderMessage('assistant', '...');
            const log = document.getElementById('llm-chat-log');
            const thinking = log.lastChild;

            const response = await fetch(`${LLM_CONFIG.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${LLM_CONFIG.apiKey}`
                },
                body: JSON.stringify({
                    model: LLM_CONFIG.model,
                    messages: messages,
                    temperature: 0.1,
                    max_tokens: 1024
                })
            });

            if (!response.ok) {
                const err = await response.text();
                throw new Error(`API error ${response.status}: ${err}`);
            }

            const data = await response.json();
            const msg = data.choices[0].message;
            const rawContent = msg.content || '';

            // Extract code — strip markdown code fences if model wraps them
            let code = rawContent.trim();
            const codeBlockMatch = code.match(/^```[a-z]*\n?([\s\S]*?)```$/);
            if (codeBlockMatch) {
                code = codeBlockMatch[1].trim();
            }

            thinking.remove();

            // Show a short excerpt of the model's thinking chain
            if (msg.reasoning) {
                const excerpt = msg.reasoning.length > 150
                    ? msg.reasoning.substring(0, 150) + '...'
                    : msg.reasoning;
                this.renderMessage('system', '💭 ' + excerpt);
            }

            this.history.push({ role: 'assistant', content: rawContent });
            this.renderCode(code);

            // Execute in global scope, then force a render pass
            try {
                (new Function(code))();
                if (typeof render === 'function') render();
            } catch (execErr) {
                this.renderMessage('error', 'Execution error: ' + execErr.message);
                console.error('LLM eval error:', execErr, '\nCode:', code);
            }

        } catch (err) {
            const log = document.getElementById('llm-chat-log');
            if (log.lastChild && log.lastChild.textContent === '...') {
                log.lastChild.remove();
            }
            this.renderMessage('error', 'Error: ' + err.message);
            console.error('LLM fetch error:', err);
        } finally {
            input.disabled = false;
            sendBtn.disabled = false;
            input.focus();
        }
    },

    clearHistory() {
        this.history = [];
        document.getElementById('llm-chat-log').innerHTML = '';
        this.renderMessage('system', 'Chat cleared. History reset.');
    },

    handleKeydown(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            llmChat.sendMessage();
        }
    }
};
