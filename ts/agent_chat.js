/**
 * Agent Chat — Multi-agent LangGraph-style pipeline for oxDNA viewer
 *
 * Pipeline: Planner → [Executor → Observer → (retry?)] × N → Summarizer
 *
 * ─────────────────────────────────────────────────────────────────────
 * API KEY SETUP (Anthropic claude-haiku or claude-sonnet):
 *   Option 1: Click the 🔑 button in the Agent AI panel at runtime.
 *             Key is saved in localStorage under 'oxview_agent_api_key'.
 *   Option 2: Hardcode below for development (not recommended for prod).
 *
 * KEY EXHAUSTION: 401 / 403 / 429 errors are surfaced in the panel.
 * ─────────────────────────────────────────────────────────────────────
 */

const AGENT_CONFIG = {
    baseURL: (window.OXVIEW_CONFIG || {}).agentBaseURL || "https://floodgate.g.apple.com/api/openai/v1",
    model: (window.OXVIEW_CONFIG || {}).agentModel || "aws:anthropic.claude-3-5-haiku-20241022-v1:0",
    get apiKey() {
        return localStorage.getItem('oxview_agent_api_key') || (window.OXVIEW_CONFIG || {}).llmApiKey || '';
    }
};

const AGENT_MAX_RETRIES = 3;

// ─────────────────────────────────────────────────────────────
// Viewer API reference shared by all agents
// ─────────────────────────────────────────────────────────────
const AGENT_VIEWER_API = `
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
    editHistory.undo(); render();   // undo last edit
    editHistory.redo(); render();   // redo last undone edit

════════════════════════════════════════
api.* — SCENE & VISUALIZATION
════════════════════════════════════════
api.getElements(ids: number[])                        → BasicElement[]
api.selectElementIDs(ids: number[], keepPrev?: bool)  → void
api.selectElements(elems: BasicElement[], keepPrev?)  → void
api.findElement(element: BasicElement, steps?: number) → void
api.highlight5ps(system?: System)                     → void
api.highlight3ps(system?: System)                     → void
api.toggleStrand(strand: Strand)                      → Strand
api.toggleElements(elems: BasicElement[])             → void
api.toggleAll(system?: System)                        → void
api.toggleBaseColors()                                → void
api.countStrandLength(system?: System)                → {[len]: Strand[]}
api.trace53(element: BasicElement)                    → BasicElement[]
api.trace35(element: BasicElement)                    → BasicElement[]
api.switchCamera()                                    → void
api.setBackgroundColor(color: string)                 → void
api.showColorbar()                                    → void
api.removeColorbar()                                  → void
api.changeColormap(name: string)                      → void
api.setColorBounds(min: number, max: number)          → void
api.showEverything()                                  → void

════════════════════════════════════════
edit.* — STRUCTURE EDITING
════════════════════════════════════════
edit.createStrand(sequence, createDuplex?, isRNA?)    → BasicElement[]
    Returns: [0]=first top-strand nucleotide, [1]=first bottom-strand nucleotide, then rest.
    Get strands: elems[0].strand (top), elems[1].strand (bottom). NEVER use elems[0].pair.strand.
    CRITICAL: if calling createStrand more than once, translateElements the first result away
    BEFORE the second call — both place at the same camera position and findPair() will
    incorrectly match across duplexes, leaving .pair undefined.
      var d1 = edit.createStrand(seq, true);
      translateElements(new Set(d1.filter(Boolean)), new THREE.Vector3(10, 0, 0));
      var d2 = edit.createStrand(seq, true); // now safe
edit.extendStrand(end: BasicElement, sequence)        → BasicElement[]
edit.extendDuplex(end: Nucleotide, sequence)          → BasicElement[]
    Physically extend a duplex from a terminal nucleotide, growing the helix geometry.
    Use this — not ligate — when you want a longer physically valid duplex.
    Example: edit.extendDuplex(systems[0].strands[0].end3, 'AAAGGG');
edit.deleteElements(victims: BasicElement[])          → void
    Each element has a .color property (THREE.Color or undefined). Use it to delete by colour:
      var toDelete = [];
      systems.forEach(function(sys){ sys.getMonomers().forEach(function(e){
        var c = e.color; if (c && c.b > 0.6 && c.r < 0.4) toDelete.push(e); // blue
      }); });
      edit.deleteElements(toDelete); render();
edit.nick(element: BasicElement)                      → void
edit.ligate(a: BasicElement, b: BasicElement)         → void
    Purely topological — does NOT move or reposition atoms.
    Only call when ends are already physically adjacent. For end-to-end extension use extendDuplex.
edit.skip(elems: BasicElement[])                      → void
edit.insert(e: BasicElement, sequence)                → BasicElement[]
edit.getSequence(elems: Set<BasicElement>)            → string
edit.setSequence(elems: Set<BasicElement>, seq, setComplementary?) → void
edit.createBP(elem: Nucleotide, undoable?)            → Nucleotide
edit.interconnectDuplex3p(strand1, strand2, patchSeq?) → void
edit.interconnectDuplex5p(strand1, strand2, patchSeq?) → void
edit.addElementsAt(copies: InstanceCopy[], pos?)      → BasicElement[]
edit.addElements(copies: InstanceCopy[])              → BasicElement[]
edit.move_to(target: BasicElement, toDisplace: BasicElement[]) → void

════════════════════════════════════════
GLOBAL TRANSFORM FUNCTIONS
════════════════════════════════════════
translateElements(elements: Set<BasicElement>, v: THREE.Vector3) → void
rotateElements(elements, axis: THREE.Vector3, angle: number, about: THREE.Vector3) → void
rotateElementsByQuaternion(elements, q: THREE.Quaternion, about?) → void

════════════════════════════════════════
SYSTEM & ELEMENT METHODS
════════════════════════════════════════
system.getMonomers()   → BasicElement[]
system.strands         : Strand[]
strand.getMonomers()   → BasicElement[]
strand.end5 / strand.end3 : BasicElement
element.getPos()       → THREE.Vector3
element.strand         : Strand
element.pair           : Nucleotide|null
element.n3 / element.n5 : BasicElement
element.id             : number
element.isPaired()     → bool
element.changeType(base: string) → void

════════════════════════════════════════
UI HELPERS
════════════════════════════════════════
notify(message, type?, keepOpen?, title?)
    type: 'success'|'warning'|'alert'|'info'

ask(title, content, onYes?, onNo?)

colorElements(color?, elems?)
    IMPORTANT: elems is BasicElement[] (not a Set). If omitted, uses Array.from(selectedBases).
    If selectedBases is empty and elems is not given, shows a warning and colours NOTHING.
    colorElements() also clears the selection (selectedBases) after colouring.
    ALWAYS pass elems explicitly — never rely on implicit selection state.
      colorElements(new THREE.Color(1,0,0), Array.from(selectedBases)); // colour selection
      colorElements(new THREE.Color(1,0,0), systems[0].getMonomers());  // colour all
      colorElements(new THREE.Color(0,0,1), api.getElements([0,1,2])); // colour by ID

updateColoring(mode?)   — modes: 'Overlay','Strand','Custom','Position','Base','Index','Cluster'
resetCustomColoring()   — reset to Strand mode
view.toggleWindow(id, oncreate?)
view.saveCanvasImage(scaleFactor?)
resetScene(resetCamera?)
findBasepairs(minLen?)

CRITICAL SCOPE RULE:
Each code block runs in its own new Function() scope. Variables from prior blocks (d1, d2, seq, etc.)
DO NOT EXIST. Always re-acquire references from global state:
  var allMonomers = [];
  systems.forEach(function(sys){ allMonomers = allMonomers.concat(sys.getMonomers()); });
  var clusterIds = Array.from(new Set(allMonomers.map(function(e){ return e.clusterId; }))).sort(function(a,b){ return a-b; });
  var c1elems = allMonomers.filter(function(e){ return e.clusterId === clusterIds[clusterIds.length-2]; });
  var c2elems = allMonomers.filter(function(e){ return e.clusterId === clusterIds[clusterIds.length-1]; });

CRITICAL SELECTION RULES:
- colorElements(color) alone does NOTHING if selectedBases is empty. Always pass elems explicitly.
- Capture selectedBases into a local var BEFORE calling colorElements (it clears selection afterwards):
    var targets = Array.from(selectedBases);
    colorElements(new THREE.Color(1,0,0), targets);
- edit.deleteElements / edit.getSequence / edit.setSequence: pass selectedBases (a Set) directly.
- To delete by colour ("remove the blue duplex"), filter on element.color (THREE.Color) — NEVER guess by clusterId:
    var toDelete = [];
    systems.forEach(function(sys){ sys.getMonomers().forEach(function(e){
      var c = e.color;
      if (c && c.b > 0.6 && c.r < 0.4) toDelete.push(e); // blue
    }); });
    edit.deleteElements(toDelete); render();
  Common thresholds:
    red: c.r>0.6&&c.g<0.4&&c.b<0.4  green: c.g>0.6&&c.r<0.4&&c.b<0.4
    blue: c.b>0.6&&c.r<0.4           yellow: c.r>0.7&&c.g>0.5&&c.b<0.3
`;

// ─────────────────────────────────────────────────────────────
// Agent system prompts
// ─────────────────────────────────────────────────────────────

const PLANNER_SYSTEM = `You are a planning agent for oxDNA viewer (oxView), a 3D molecular visualization and editing tool for DNA/RNA nanostructures.

Given a user's task, decompose it into 1-5 concrete, sequential steps that JavaScript can execute.
For simple single-action tasks, return just 1 step.
For complex tasks, break them into logical ordered sub-tasks.

Rules:
- Respond with ONLY a JSON array of step description strings — no markdown, no explanation.
- Each step is a clear imperative action: "Select all nucleotides in system 0", "Color selected elements red".
- Maximum 5 steps.
- Order steps so each builds on the previous.
- For colouring tasks: always specify WHAT to colour explicitly in the step description.
  Use "Color all nucleotides in system 0 red" (not just "Color red") so the executor knows the target without relying on implicit selection state.

Example: ["Select all nucleotides in system 0", "Color the selection blue", "Zoom camera to the selection"]`;

const EXECUTOR_SYSTEM = `You are a code execution agent for oxDNA viewer (oxView), a 3D molecular visualization and editing tool for DNA/RNA nanostructures.

Given a single step description, generate the JavaScript code to perform exactly that step.
Respond with ONLY valid JavaScript — no explanations, no markdown, no code blocks. Always end with render();

${AGENT_VIEWER_API}

COMMON PATTERNS:
// Move system 0 COM to (x,y,z):
var monomers = systems[0].getMonomers();
var com = new THREE.Vector3();
monomers.forEach(function(e){ com.add(e.getPos()); });
com.divideScalar(monomers.length);
translateElements(new Set(monomers), new THREE.Vector3(X,Y,Z).sub(com));
render();

// Color the currently selected elements red (capture before colorElements clears selection):
var targets = Array.from(selectedBases);
if (targets.length === 0) {
    notify('No elements selected', 'warning');
} else {
    colorElements(new THREE.Color(1, 0, 0), targets);
    render();
}

// Color ALL elements in system 0 red (no selection needed):
colorElements(new THREE.Color(1, 0, 0), systems[0].getMonomers());
render();

// Select all in system 0 (api.selectElements calls render() internally):
api.selectElements(systems[0].getMonomers());

// OXDNA UNIT REFERENCE: 1 oxDNA unit ≈ 0.85 nm.
// DNA duplex diameter ≈ 2.35 oxDNA units. Adjacent parallel duplexes: ~3 units centre-to-centre.
// NEVER use offsets > 5 for "next to each other" — that places duplexes far apart visually.

// Create two duplexes side by side (~3 units apart):
var seq = 'ATCGATCGATCGATCGATCG';
var d1 = edit.createStrand(seq, true);
var com1 = new THREE.Vector3();
d1.filter(Boolean).forEach(function(e){ com1.add(e.getPos()); });
com1.divideScalar(d1.filter(Boolean).length);
translateElements(new Set(d1.filter(Boolean)), com1.clone().negate());
var d2 = edit.createStrand(seq, true);
var com2 = new THREE.Vector3();
d2.filter(Boolean).forEach(function(e){ com2.add(e.getPos()); });
com2.divideScalar(d2.filter(Boolean).length);
translateElements(new Set(d2.filter(Boolean)), new THREE.Vector3(3, 0, 0).sub(com2));
render();

// Extend an existing duplex end-to-end (PREFERRED — physically grows the helix):
var elems = edit.createStrand('ATCGATCGATCGATC', true);
edit.extendDuplex(elems[0].strand.end3, 'GCTAGCTAGCTAGCT');
render();

// Ligate two already-adjacent duplexes using clusterId (robust strand lookup):
// ONLY use ligate when ends are physically adjacent — it does NOT move atoms.
var allMonomers = [];
systems.forEach(function(sys){ allMonomers = allMonomers.concat(sys.getMonomers()); });
var clusterIds = Array.from(new Set(allMonomers.map(function(e){ return e.clusterId; }))).sort(function(a,b){ return a-b; });
var c1 = clusterIds[clusterIds.length-2];
var c2 = clusterIds[clusterIds.length-1];
var allStrands = [];
systems.forEach(function(sys){ allStrands = allStrands.concat(sys.strands); });
var s1 = allStrands.filter(function(s){ return s.getMonomers().some(function(e){ return e.clusterId===c1; }); });
var s2 = allStrands.filter(function(s){ return s.getMonomers().some(function(e){ return e.clusterId===c2; }); });
edit.ligate(s1[0].end3, s2[0].end5);
edit.ligate(s2[1].end3, s1[1].end5);
render();

// Set the angle between two end-to-end duplexes (e.g., 60 degrees):
// CRITICAL: NEVER use a fixed axis like (0,0,1). Always compute the rotation axis
// as the cross product of the two duplex direction vectors.
var allMonomers = [];
systems.forEach(function(sys){ allMonomers = allMonomers.concat(sys.getMonomers()); });
var clusterIds = Array.from(new Set(allMonomers.map(function(e){ return e.clusterId; }))).sort(function(a,b){ return a-b; });
var c1 = clusterIds[clusterIds.length-2];
var c2 = clusterIds[clusterIds.length-1];
var e1 = allMonomers.filter(function(e){ return e.clusterId === c1; });
var e2 = allMonomers.filter(function(e){ return e.clusterId === c2; });
var com1 = new THREE.Vector3(), com2 = new THREE.Vector3();
e1.forEach(function(e){ com1.add(e.getPos()); }); com1.divideScalar(e1.length);
e2.forEach(function(e){ com2.add(e.getPos()); }); com2.divideScalar(e2.length);
// Find junction point (midpoint of the closest pair between the two clusters)
var minDist = Infinity, junction = new THREE.Vector3();
e1.forEach(function(a){ e2.forEach(function(b){
    var d = a.getPos().distanceTo(b.getPos());
    if(d < minDist){ minDist = d; junction = a.getPos().clone().add(b.getPos()).multiplyScalar(0.5); }
}); });
// Direction vectors from junction to each COM
var dir1 = com1.clone().sub(junction).normalize();
var dir2 = com2.clone().sub(junction).normalize();
// Rotation axis: perpendicular to both duplex directions
var rotAxis = new THREE.Vector3().crossVectors(dir1, dir2).normalize();
if(rotAxis.lengthSq() < 0.001) rotAxis.set(0, 1, 0); // fallback if parallel
// Current angle between duplexes
var currentAngle = Math.acos(Math.max(-1, Math.min(1, dir1.dot(dir2))));
var targetAngle = Math.PI / 3; // 60 degrees — change as needed
var deltaAngle = currentAngle - targetAngle;
rotateElements(new Set(e2), rotAxis, deltaAngle, junction);
render();

// Create a Holliday junction (X-shaped four-way DNA junction):
// Two 20-bp duplexes nicked and cross-ligated at their midpoints.
var seq = 'ATCGATCGATCGATCGATCG';
var d1 = edit.createStrand(seq, true);
translateElements(new Set(d1.filter(Boolean)), new THREE.Vector3(0, 10, 0));
var d2 = edit.createStrand(seq, true);
var s0 = d1[0].strand, s1_ = d1[1].strand;
var s2 = d2[0].strand, s3 = d2[1].strand;
var d2elems = d2.filter(Boolean);
var com1 = new THREE.Vector3(), com2 = new THREE.Vector3();
d1.filter(Boolean).forEach(function(e){ com1.add(e.getPos()); });
com1.divideScalar(d1.filter(Boolean).length);
d2elems.forEach(function(e){ com2.add(e.getPos()); });
com2.divideScalar(d2elems.length);
translateElements(new Set(d2elems), new THREE.Vector3(2.3, 0, 0).add(com1).sub(com2));
// nick(s0m[9]) → s0m[9].n3=null (3' terminal), s0m[10].n5=null (5' terminal)
// ligate(s0m[9], s2m[10]) succeeds because !a.n3 && !b.n5
var s0m = s0.getMonomers(), s1m = s1_.getMonomers();
var s2m = s2.getMonomers(), s3m = s3.getMonomers();
edit.nick(s0m[9]); edit.nick(s1m[9]);
edit.nick(s2m[9]); edit.nick(s3m[9]);
edit.ligate(s0m[9], s2m[10]); edit.ligate(s2m[9], s0m[10]);
edit.ligate(s1m[9], s3m[10]); edit.ligate(s3m[9], s1m[10]);
// Colour the 4 resulting strands (ligate updates element.strand pointers)
colorElements(new THREE.Color(0.9,0.1,0.1), s0m[0].strand.getMonomers());
colorElements(new THREE.Color(0.1,0.5,0.9), s2m[0].strand.getMonomers());
colorElements(new THREE.Color(0.1,0.8,0.1), s1m[0].strand.getMonomers());
colorElements(new THREE.Color(0.9,0.7,0.1), s3m[0].strand.getMonomers());
notify('Holliday junction created', 'success');
render();`;

const OBSERVER_SYSTEM = `You are a code verification agent for oxDNA viewer. Evaluate whether a step executed correctly.

You receive:
- The step description (what should happen)
- The JavaScript code that was executed
- The execution result ("SUCCESS" or an error message starting with "ERROR:")

Determine if the step completed successfully and respond with ONLY a JSON object (no markdown):
{"success": true, "feedback": "brief note"}
or
{"success": false, "feedback": "specific guidance on how to fix the code"}

Rules:
- If the result is "SUCCESS", return success:true unless the step clearly could not have worked (e.g. wrong function name)
- If the result starts with "ERROR:", return success:false with targeted fix guidance
- Keep feedback under 120 characters`;

const SUMMARIZER_SYSTEM = `You are a results summarizer for oxDNA viewer. Write a brief 1-3 sentence summary of what was accomplished.

Be friendly, specific about what changed in the molecular structure, and mention any failed steps.
Do not use markdown formatting. Start directly with what was done.`;

// ─────────────────────────────────────────────────────────────
// Core API call — OpenAI-compatible /chat/completions format
// ─────────────────────────────────────────────────────────────
async function agentApiCall(systemPrompt, userMessage) {
    const key = AGENT_CONFIG.apiKey;
    if (!key) {
        throw new Error('NO_KEY: No API key set. Click the 🔑 button in the Agent AI panel to add your API key.');
    }

    const response = await fetch(`${AGENT_CONFIG.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
            model: AGENT_CONFIG.model,
            max_tokens: 2048,
            temperature: 0.1,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage }
            ]
        })
    });

    if (!response.ok) {
        let errBody = {};
        try { errBody = await response.json(); } catch (_) {}
        const msg = errBody.error?.message || JSON.stringify(errBody);

        if (response.status === 401 || response.status === 403) {
            throw new Error(`AUTH_ERROR: API key invalid or unauthorized. (${msg})`);
        }
        if (response.status === 429) {
            throw new Error(`QUOTA_ERROR: Rate-limited or quota exhausted. (${msg})`);
        }
        throw new Error(`API error ${response.status}: ${msg}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Empty response from API');
    return text;
}

// ─────────────────────────────────────────────────────────────
// Individual agents
// ─────────────────────────────────────────────────────────────
async function agentPlanner(task) {
    const raw = await agentApiCall(PLANNER_SYSTEM, `Task: ${task}`);
    const match = raw.match(/\[[\s\S]*?\]/);
    if (!match) throw new Error(`Planner returned non-JSON: ${raw.substring(0, 80)}`);
    return JSON.parse(match[0]);
}

async function agentExecutor(step, retryContext) {
    const userMsg = retryContext
        ? `Step to execute: ${step}\n\nPrevious attempt failed — fix guidance:\n${retryContext}`
        : `Step to execute: ${step}`;
    const raw = await agentApiCall(EXECUTOR_SYSTEM, userMsg);
    // Strip markdown code fences if the model wrapped them
    const fenceMatch = raw.match(/```(?:javascript|js)?\n?([\s\S]*?)```/);
    return fenceMatch ? fenceMatch[1].trim() : raw.trim();
}

async function agentObserver(step, code, execResult) {
    const userMsg = `Step: ${step}\n\nCode:\n${code}\n\nResult: ${execResult}`;
    const raw = await agentApiCall(OBSERVER_SYSTEM, userMsg);
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]); } catch (_) {}
    }
    // Fallback: treat exec success as observer success
    return { success: !execResult.startsWith('ERROR'), feedback: raw.substring(0, 100) };
}

async function agentSummarizer(task, stepResults) {
    const stepsText = stepResults
        .map((s, i) => `Step ${i + 1}: "${s.step}" — ${s.success ? 'succeeded' : 'failed'}`)
        .join('\n');
    return await agentApiCall(SUMMARIZER_SYSTEM, `Task: ${task}\n\nOutcomes:\n${stepsText}`);
}

// ─────────────────────────────────────────────────────────────
// Helper: escape HTML for code display
// ─────────────────────────────────────────────────────────────
function agentEscapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─────────────────────────────────────────────────────────────
// Main agentChat object
// ─────────────────────────────────────────────────────────────
const agentChat = {
    isOpen: false,
    isRunning: false,

    toggle() {
        const panel = document.getElementById('agent-chat-panel');
        this.isOpen = !this.isOpen;
        panel.style.display = this.isOpen ? 'flex' : 'none';
        if (this.isOpen) {
            document.getElementById('agent-chat-input').focus();
            this._updateKeyStatus();
        }
    },

    _updateKeyStatus() {
        const el = document.getElementById('agent-key-status');
        if (!el) return;
        const key = AGENT_CONFIG.apiKey;
        el.textContent = key ? `🔑 Key: …${key.slice(-4)}` : '🔑 No key set';
        el.style.color = key ? '#6ee7b7' : '#f87171';
    },

    setApiKey() {
        const current = AGENT_CONFIG.apiKey;
        const input = prompt(
            'Enter your Anthropic API key.\nIt will be saved in localStorage.\nLeave blank to clear.',
            current
        );
        if (input === null) return; // cancelled
        if (input.trim()) {
            localStorage.setItem('oxview_agent_api_key', input.trim());
            this._log('system', '🔑 API key saved.');
        } else {
            localStorage.removeItem('oxview_agent_api_key');
            this._log('system', '🔑 API key cleared.');
        }
        this._updateKeyStatus();
    },

    clearLog() {
        document.getElementById('agent-chat-log').innerHTML = '';
        this._log('system', 'Log cleared. Ready for a new task.');
    },

    _log(type, text) {
        const log = document.getElementById('agent-chat-log');
        const el = document.createElement('div');
        el.className = `agent-msg agent-msg-${type}`;
        el.textContent = text;
        log.appendChild(el);
        log.scrollTop = log.scrollHeight;
        return el;
    },

    _logCode(code) {
        const log = document.getElementById('agent-chat-log');
        const el = document.createElement('div');
        el.className = 'agent-msg agent-msg-code';
        el.innerHTML = `<pre>${agentEscapeHtml(code)}</pre>`;
        log.appendChild(el);
        log.scrollTop = log.scrollHeight;
        return el;
    },

    _setStage(stage) {
        // stage: 'planner' | 'executor' | 'observer' | 'summarizer' | null
        ['planner', 'executor', 'observer', 'summarizer'].forEach(s => {
            const el = document.getElementById(`agent-stage-${s}`);
            if (el) el.classList.toggle('active', s === stage);
        });
    },

    handleKeydown(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            agentChat.run();
        }
    },

    async run() {
        if (this.isRunning) return;

        const input = document.getElementById('agent-chat-input');
        const sendBtn = document.getElementById('agent-chat-send');
        const task = input.value.trim();
        if (!task) return;

        if (!AGENT_CONFIG.apiKey) {
            this._log('error', '🔑 No API key set. Click the 🔑 button to add your Anthropic API key.');
            return;
        }

        input.value = '';
        input.disabled = true;
        sendBtn.disabled = true;
        this.isRunning = true;

        this._log('user', task);

        try {
            // ── Stage 1: Plan ──────────────────────────────────
            this._setStage('planner');
            const planningEl = this._log('planner', '🗂 Planning steps...');

            let steps;
            try {
                steps = await agentPlanner(task);
            } catch (e) {
                planningEl.textContent = `🗂 Planning failed: ${e.message}`;
                planningEl.className = 'agent-msg agent-msg-error';
                throw e;
            }

            planningEl.remove();
            this._log('planner', `📋 Plan — ${steps.length} step${steps.length !== 1 ? 's' : ''}:`);
            steps.forEach((s, i) => this._log('planner-step', `  ${i + 1}. ${s}`));

            const stepResults = [];

            // ── Stage 2 & 3: Execute + Observe each step ───────
            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                this._log('divider', `── Step ${i + 1} / ${steps.length} ──────────────────────`);
                this._log('system', `▶ ${step}`);

                let success = false;
                let lastCode = '';
                let retryContext = '';

                for (let attempt = 0; attempt < AGENT_MAX_RETRIES; attempt++) {
                    // Execute
                    this._setStage('executor');
                    const attemptSuffix = attempt > 0 ? ` (retry ${attempt}/${AGENT_MAX_RETRIES - 1})` : '';
                    const execEl = this._log('executor', `⚙️ Generating code${attemptSuffix}...`);

                    try {
                        lastCode = await agentExecutor(step, attempt > 0 ? retryContext : '');
                    } catch (e) {
                        execEl.textContent = `⚙️ Code generation error: ${e.message}`;
                        execEl.className = 'agent-msg agent-msg-error';
                        throw e;
                    }
                    execEl.remove();
                    this._logCode(lastCode);

                    // Run the code
                    let execResult = 'SUCCESS';
                    try {
                        (new Function(lastCode))();
                        if (typeof render === 'function') render();
                    } catch (execErr) {
                        execResult = `ERROR: ${execErr.message}`;
                        this._log('error', `⚠ Exec error: ${execErr.message}`);
                        console.error('Agent exec error:', execErr, '\nCode:', lastCode);
                    }

                    // Observe
                    this._setStage('observer');
                    const obsEl = this._log('observer', '🔍 Verifying result...');

                    let observation;
                    try {
                        observation = await agentObserver(step, lastCode, execResult);
                    } catch (_) {
                        // If observer itself fails, fall back to exec result
                        observation = { success: execResult === 'SUCCESS', feedback: 'Verification unavailable' };
                    }

                    if (observation.success) {
                        obsEl.textContent = '✅ Step verified';
                        obsEl.className = 'agent-msg agent-msg-success';
                        success = true;
                        break;
                    } else {
                        obsEl.textContent = `⚠ ${observation.feedback}`;
                        obsEl.className = 'agent-msg agent-msg-warning';
                        retryContext = observation.feedback;
                        if (attempt === AGENT_MAX_RETRIES - 1) {
                            this._log('error', `✗ Step ${i + 1} failed after ${AGENT_MAX_RETRIES} attempts.`);
                        }
                    }
                }

                stepResults.push({ step, success, code: lastCode });
            }

            // ── Stage 4: Summarize ──────────────────────────────
            this._setStage('summarizer');
            const sumEl = this._log('summarizer', '📝 Summarizing...');

            try {
                const summary = await agentSummarizer(task, stepResults);
                sumEl.remove();
                this._log('summary', '📝 ' + summary);
            } catch (e) {
                sumEl.textContent = `📝 Summary error: ${e.message}`;
                sumEl.className = 'agent-msg agent-msg-error';
            }

        } catch (err) {
            this._log('error', `❌ ${err.message}`);
            console.error('Agent pipeline error:', err);

            if (err.message.includes('QUOTA_ERROR') || err.message.includes('AUTH_ERROR')) {
                this._log('error', '⚠ Your API key may be exhausted or invalid. Check your Anthropic account at console.anthropic.com.');
            }
        } finally {
            this._setStage(null);
            this.isRunning = false;
            input.disabled = false;
            sendBtn.disabled = false;
            input.focus();
        }
    }
};
