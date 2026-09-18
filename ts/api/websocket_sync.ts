/**
 * WebSocket Synchronization Layer for oxDNA-Viewer
 *
 * Handles bidirectional communication with NanoCanvas backend.
 * Listens for events from ncSync API and forwards them to NanoCanvas.
 * Receives events from NanoCanvas and applies them to oxView scene.
 */

/// <reference path="nanocanvas_sync_api.ts" />

module wsSync {
    let ws: WebSocket | null = null;
    let isConnected: boolean = false;
    let wantConnection: boolean = false;
    let reconnectTimer: number | null = null;
    let messageQueue: any[] = [];
    let connectAttempts: number = 0;
    let lastTriedUrl: string | null = null;
    let dormant: boolean = false;  // backend absent: capped out, staying quiet
    let dormantNotified: boolean = false;
    let statusListeners: ((s: object) => void)[] = [];

    // Configuration
    const WS_PORT = 8765;  // NanoCanvas backend port
    const WS_PATH = '/ws';  // NanoCanvas WebSocket endpoint
    const MAX_CONNECT_ATTEMPTS = 5;
    const RECONNECT_BASE_DELAY = 1000;  // 1s, doubled per attempt (1s..16s)
    const MAX_QUEUED_MESSAGES = 100;

    /**
     * Default URL: derive the ws/wss scheme from how the page itself was
     * served (wss:// under https — a hardcoded ws:// would be blocked as
     * mixed content), and talk to the backend on the same host.
     * Falls back to ws://localhost:8765/ws (e.g. file:// or workers).
     */
    function defaultWsUrl(): string {
        try {
            if (typeof location !== 'undefined' && location.hostname) {
                const scheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
                return scheme + location.hostname + ':' + WS_PORT + WS_PATH;
            }
        } catch (_) {
            // location inaccessible — use localhost default below
        }
        return 'ws://localhost:' + WS_PORT + WS_PATH;
    }

    const WS_URL = defaultWsUrl();

    /**
     * Human-readable one-liner so any live-sync toggle can show clearly
     * whether sync is connected or dormant (backend absent).
     */
    export function statusText(): string {
        if (isConnected) return 'Live Sync ON — connected';
        if (dormant) return 'Live Sync dormant — backend unavailable';
        if (wantConnection && connectAttempts > 0) return 'Live Sync connecting…';
        return 'Live Sync off — disconnected';
    }

    function emitStatus(): void {
        const s = getStatus();
        for (const cb of statusListeners) {
            try { cb(s); } catch (e) { console.error('wsSync status listener error:', e); }
        }
    }

    export function onStatusChange(cb: (s: object) => void): void {
        statusListeners.push(cb);
        try { cb(getStatus()); } catch (e) { console.error('wsSync status listener error:', e); }
    }

    export function removeStatusListener(cb: (s: object) => void): void {
        statusListeners = statusListeners.filter(fn => fn !== cb);
    }

    function clearReconnectTimer(): void {
        if (reconnectTimer !== null) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
    }

    /**
     * A connection attempt failed (refused / unreachable / threw).
     * Back off quietly with capped retries, then stay dormant: one
     * one-line status, no reconnect storm, no unhandled exceptions.
     */
    function handleConnectFailure(url: string, err: any): void {
        isConnected = false;
        connectAttempts++;
        const reason = (err && (err.message || err.toString())) || 'connection refused';
        if (connectAttempts >= MAX_CONNECT_ATTEMPTS) {
            dormant = true;
            wantConnection = false;
            clearReconnectTimer();
            // One line only, then silence — the viewer works fine without
            // the backend; live sync just stays dormant.
            console.info(`[wsSync] NanoCanvas backend unavailable at ${url} (${reason}); `
                + `gave up after ${connectAttempts} attempts — live sync dormant.`);
            if (!dormantNotified) {
                dormantNotified = true;
                try { notify('Live sync dormant — NanoCanvas backend not running'); } catch (_) {}
            }
            emitStatus();
            return;
        }
        const delay = RECONNECT_BASE_DELAY * Math.pow(2, connectAttempts - 1);
        console.info(`[wsSync] Backend unreachable at ${url} (${reason}); `
            + `retry ${connectAttempts}/${MAX_CONNECT_ATTEMPTS} in ${delay}ms.`);
        emitStatus();
        if (wantConnection) {
            clearReconnectTimer();
            reconnectTimer = window.setTimeout(() => {
                reconnectTimer = null;
                if (wantConnection && !isConnected && !dormant) connect(url);
            }, delay);
        }
    }

    /**
     * Connect to NanoCanvas WebSocket server.
     * Safe to call with no backend running: failures back off quietly
     * (capped retries, then dormant) instead of throwing or storming.
     */
    export function connect(url: string = WS_URL): void {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            return;
        }
        if (url !== lastTriedUrl) {
            // New target — fresh attempt budget.
            connectAttempts = 0;
            dormant = false;
            dormantNotified = false;
        } else if (dormant) {
            // Already capped out for this URL: stay dormant, no storm.
            emitStatus();
            return;
        }
        lastTriedUrl = url;
        wantConnection = true;

        console.log(`Connecting to NanoCanvas at ${url}...`);
        let socket: WebSocket;
        try {
            socket = new WebSocket(url);
        } catch (e) {
            handleConnectFailure(url, e);
            return;
        }
        ws = socket;

        ws.onopen = () => {
            console.log('WebSocket connected to NanoCanvas');
            isConnected = true;
            dormant = false;
            dormantNotified = false;
            connectAttempts = 0;
            clearReconnectTimer();
            notify('Connected to NanoCanvas');
            emitStatus();

            // Send queued messages
            while (messageQueue.length > 0) {
                const msg = messageQueue.shift();
                send(msg);
            }

            // Request initial state sync
            send({
                type: 'request_state',
                source: 'oxview',
                timestamp: Date.now()
            });
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                handleMessage(message);
            } catch (e) {
                console.error('Failed to parse WebSocket message:', e);
            }
        };

        ws.onerror = () => {
            // onclose follows with details; stay quiet here to avoid
            // double-reporting every failed attempt.
            console.info(`[wsSync] connection attempt to ${url} failed; waiting for close handler.`);
        };

        ws.onclose = () => {
            const wasConnected = isConnected;
            console.log('WebSocket disconnected');
            isConnected = false;
            if (ws === socket) ws = null;
            if (wasConnected) {
                try { notify('Disconnected from NanoCanvas'); } catch (_) {}
            }
            emitStatus();
            if (wantConnection && !dormant) {
                handleConnectFailure(url, 'connection closed');
            }
        };
    }

    /**
     * Disconnect from WebSocket server
     */
    export function disconnect(): void {
        wantConnection = false;
        clearReconnectTimer();
        if (ws) {
            try { ws.close(); } catch (_) {}
            ws = null;
        }
        isConnected = false;
        emitStatus();
    }

    /**
     * Send a message to NanoCanvas
     */
    function send(message: any): void {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            // Queue while disconnected, but cap it so a long dormant
            // stretch can't grow memory without bound.
            if (messageQueue.length >= MAX_QUEUED_MESSAGES) messageQueue.shift();
            messageQueue.push(message);
            return;
        }

        try {
            ws.send(JSON.stringify(message));
        } catch (e) {
            console.error('Failed to send WebSocket message:', e);
        }
    }

    /**
     * Handle incoming message from NanoCanvas
     */
    function handleMessage(message: any): void {
        console.log('Received from NanoCanvas:', message);

        // Ignore messages originating from oxView to prevent loops
        if (message.source === 'oxview') {
            return;
        }

        // Handle different message types
        switch (message.type) {
            case 'helix_created':
                handleHelixCreated(message.data);
                break;

            case 'helix_removed':
                handleHelixRemoved(message.data);
                break;

            case 'strand_created':
                handleStrandCreated(message.data);
                break;

            case 'strand_deleted':
                handleStrandDeleted(message.data);
                break;

            case 'strand_range_changed':
                handleStrandRangeChanged(message.data);
                break;

            case 'strand_color_changed':
                handleStrandColorChanged(message.data);
                break;

            case 'crossover_created':
                handleCrossoverCreated(message.data);
                break;

            case 'crossover_removed':
                handleCrossoverRemoved(message.data);
                break;

            case 'state_response':
                handleStateResponse(message.data);
                break;

            case 'undo':
                editHistory.undo();
                break;

            case 'redo':
                editHistory.redo();
                break;

            default:
                console.warn('Unknown message type:', message.type);
        }
    }

    /**
     * Handle helix creation from NanoCanvas
     */
    function handleHelixCreated(data: any): void {
        ncSync.createHelix(data.row, data.col, data.max_bases || 32, data.helix_id);
        notify(`Helix ${data.helix_id} created from NanoCanvas`);
    }

    /**
     * Handle helix removal from NanoCanvas
     */
    function handleHelixRemoved(data: any): void {
        ncSync.removeHelix(data.helix_id);
        notify(`Helix ${data.helix_id} removed from NanoCanvas`);
    }

    /**
     * Handle strand creation from NanoCanvas
     */
    function handleStrandCreated(data: any): void {
        ncSync.createStrand(
            data.helix_id,
            data.direction,
            data.start,
            data.end,
            data.color,
            data.strand_id
        );
        notify(`Strand ${data.strand_id} created from NanoCanvas`);
    }

    /**
     * Handle strand deletion from NanoCanvas
     */
    function handleStrandDeleted(data: any): void {
        ncSync.deleteStrand(data.strand_id);
        notify(`Strand ${data.strand_id} deleted from NanoCanvas`);
    }

    /**
     * Handle strand range modification
     */
    function handleStrandRangeChanged(data: any): void {
        // For now, delete and recreate the strand
        // TODO: Implement more efficient extend/shrink operations
        ncSync.deleteStrand(data.strand_id);
        ncSync.createStrand(
            data.helix_id,
            data.direction,
            data.start,
            data.end,
            data.color,
            data.strand_id
        );
        notify(`Strand ${data.strand_id} range changed`);
    }

    /**
     * Handle strand color change
     */
    function handleStrandColorChanged(data: any): void {
        const strandIds = idMapper.getStrandsForHelix(data.helix_id);
        strandIds.forEach(sid => {
            if (sid === data.strand_id) {
                const strand = systems.flatMap(s => s.strands).find(s => s.id === sid);
                if (strand) {
                    const color = new THREE.Color(data.color);
                    strand.forEach(elem => {
                        elem.elemToColor(color);
                    });
                    strand.getSystem().callUpdates(['instanceColor']);
                }
            }
        });
        render();
    }

    /**
     * Handle crossover creation from NanoCanvas
     */
    function handleCrossoverCreated(data: any): void {
        ncSync.createCrossover(
            data.helix_id_a,
            data.direction_a,
            data.index_a,
            data.helix_id_b,
            data.direction_b,
            data.index_b
        );
        notify('Crossover created from NanoCanvas');
    }

    /**
     * Handle crossover removal from NanoCanvas
     */
    function handleCrossoverRemoved(data: any): void {
        ncSync.removeCrossover(
            data.helix_id,
            data.direction,
            data.index
        );
        notify('Crossover removed from NanoCanvas');
    }

    /**
     * Handle full state sync response
     */
    function handleStateResponse(data: any): void {
        console.log('Received state from NanoCanvas:', data);
        ncSync.importFromNanoCanvas(data);
        notify('Synchronized with NanoCanvas state');
    }

    /**
     * Set up event listeners for ncSync events
     */
    export function setupEventListeners(): void {
        // Listen to all ncSync events and forward to NanoCanvas
        ncSync.addEventListener('*', (event) => {
            // Only forward events originating from oxView
            if (event.source === 'oxview') {
                send({
                    type: event.type,
                    source: 'oxview',
                    timestamp: event.timestamp,
                    data: event.data
                });
            }
        });
    }

    /**
     * Initialize WebSocket sync system.
     * Safe with no backend running: connect() backs off quietly and the
     * module goes dormant instead of throwing or reconnect-storming.
     */
    export function initialize(url?: string): void {
        setupEventListeners();
        try {
            connect(url);
        } catch (e) {
            console.info('[wsSync] initialize: backend unavailable, live sync dormant.', e);
        }
        console.log('WebSocket sync initialized');
    }

    /**
     * Get connection status — a live-sync toggle should read `connected`
     * vs `dormant` (or the ready-made `status_text` one-liner).
     */
    export function getStatus(): object {
        return {
            connected: isConnected,
            dormant: dormant && !isConnected,
            url: lastTriedUrl || WS_URL,
            queued_messages: messageQueue.length,
            connect_attempts: connectAttempts,
            status_text: statusText()
        };
    }

    /**
     * Request full state sync from NanoCanvas
     */
    export function requestSync(): void {
        send({
            type: 'request_state',
            source: 'oxview',
            timestamp: Date.now()
        });
    }

    /**
     * Send current oxView state to NanoCanvas
     */
    export function pushState(): void {
        const state = ncSync.exportSyncState();
        send({
            type: 'state_update',
            source: 'oxview',
            timestamp: Date.now(),
            data: JSON.parse(state)
        });
    }
}

// Auto-initialize if in Electron environment
if (typeof window !== 'undefined' && (window as any).require) {
    // Running in Electron
    console.log('Electron environment detected, WebSocket sync available');
}
