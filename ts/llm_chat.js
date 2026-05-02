/**
 * LLM Chat interface for oxDNA viewer
 * Uses nano-gpt.com API (OpenAI-compatible) to translate natural language to viewer API calls
 */

const LLM_CONFIG = {
    baseURL: "https://nano-gpt.com/api/v1",
    model: "zai-org/glm-5.1:thinking",
    apiKey: "sk-nano-74ab9a6a-b1f8-4d34-bec2-d413387c20b6"
};

const SYSTEM_PROMPT = `You are an AI assistant for oxDNA viewer (oxView), a 3D molecular visualization and editing tool for DNA/RNA nanostructures.

Your job is to convert natural language commands into JavaScript code that controls the viewer. You MUST respond with ONLY valid JavaScript code - no explanations, no markdown, no code blocks.

Available APIs:
- edit.createStrand(sequence, createDuplex, isRNA) - Create a DNA/RNA strand. createDuplex=true creates a double helix.
- edit.extendDuplex(element, sequence) - Extend a duplex from an element
- edit.deleteElements(elements) - Delete elements
- edit.nick(element) - Nick a strand at element
- edit.ligate(element1, element2) - Ligate two elements
- edit.skip(elements) - Skip/delete elements and ligate neighbors
- edit.insert(element, sequence) - Insert sequence after element
- edit.interconnectDuplex3p(strand1, strand2, sequence) - Connect 3' ends with duplex
- edit.interconnectDuplex5p(strand1, strand2, sequence) - Connect 5' ends with duplex
- api.getElements(ids) - Get elements by ID array, returns array
- api.highlight5ps(system) - Highlight 5' ends
- api.trace35(element) - Trace strand 3' to 5'
- api.switchCamera() - Toggle camera mode
- api.setBackgroundColor(color) - Set background color (hex string)
- systems[] - Array of loaded systems, systems[0] is first system
- scene - THREE.js scene object
- render() - Re-render the scene

For "create N helix duplex" or "20 helix duplex": create a duplex strand with N base pairs.
A 20bp duplex: edit.createStrand('ATCGATCGATCGATCGATCG', true);

Multiple operations: separate with semicolons on one line or use multiple statements.

Always end your code with render(); to update the viewport.

Respond with ONLY the JavaScript code to execute.`;

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

            // Extract code from the response (handle markdown code blocks if model wraps them)
            let code = rawContent.trim();
            const codeBlockMatch = code.match(/^```[a-z]*\n?([\s\S]*?)```$/);
            if (codeBlockMatch) {
                code = codeBlockMatch[1].trim();
            }

            thinking.remove();
            // Show reasoning summary if available
            if (msg.reasoning) {
                const reasoningShort = msg.reasoning.length > 120
                    ? msg.reasoning.substring(0, 120) + '...'
                    : msg.reasoning;
                this.renderMessage('system', '💭 ' + reasoningShort);
            }
            this.history.push({ role: 'assistant', content: rawContent });
            this.renderCode(code);

            // Execute the returned code in global scope, then force a render
            try {
                (new Function(code))();
                if (typeof render === 'function') render();
            } catch (execErr) {
                this.renderMessage('error', 'Execution error: ' + execErr.message);
                console.error('LLM eval error:', execErr);
            }

        } catch (err) {
            const log = document.getElementById('llm-chat-log');
            if (log.lastChild && log.lastChild.textContent === '...') {
                log.lastChild.remove();
            }
            this.renderMessage('error', 'Error: ' + err.message);
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
