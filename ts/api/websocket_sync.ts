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
    let reconnectInterval: number | null = null;
    let messageQueue: any[] = [];

    // Configuration
    const WS_URL = 'ws://localhost:8765/ws';  // NanoCanvas WebSocket endpoint
    const RECONNECT_DELAY = 3000;  // 3 seconds

    /**
     * Connect to NanoCanvas WebSocket server
     */
    export function connect(url: string = WS_URL): void {
        if (ws && ws.readyState === WebSocket.OPEN) {
            console.log('WebSocket already connected');
            return;
        }

        console.log(`Connecting to NanoCanvas at ${url}...`);
        ws = new WebSocket(url);

        ws.onopen = () => {
            console.log('WebSocket connected to NanoCanvas');
            isConnected = true;
            notify('Connected to NanoCanvas');

            // Clear reconnect interval if set
            if (reconnectInterval) {
                clearInterval(reconnectInterval);
                reconnectInterval = null;
            }

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

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            notify('WebSocket connection error');
        };

        ws.onclose = () => {
            console.log('WebSocket disconnected');
            isConnected = false;
            notify('Disconnected from NanoCanvas');

            // Attempt reconnection
            if (!reconnectInterval) {
                reconnectInterval = window.setInterval(() => {
                    console.log('Attempting to reconnect...');
                    connect(url);
                }, RECONNECT_DELAY);
            }
        };
    }

    /**
     * Disconnect from WebSocket server
     */
    export function disconnect(): void {
        if (ws) {
            ws.close();
            ws = null;
        }
        if (reconnectInterval) {
            clearInterval(reconnectInterval);
            reconnectInterval = null;
        }
        isConnected = false;
    }

    /**
     * Send a message to NanoCanvas
     */
    function send(message: any): void {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.warn('WebSocket not connected, queuing message');
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
     * Initialize WebSocket sync system
     */
    export function initialize(url?: string): void {
        setupEventListeners();
        connect(url);
        console.log('WebSocket sync initialized');
    }

    /**
     * Get connection status
     */
    export function getStatus(): object {
        return {
            connected: isConnected,
            url: WS_URL,
            queued_messages: messageQueue.length
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
