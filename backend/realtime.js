const WebSocket = require("ws");
const { WebSocketServer } = WebSocket;

let webSocketServer = null;

function safeSend(client, payload) {
    if (client.readyState !== WebSocket.OPEN) return;
    client.send(payload);
}

function initRealtime(server) {
    if (webSocketServer) return webSocketServer;

    webSocketServer = new WebSocketServer({
        server,
        path: "/api/chargers/ws",
    });

    webSocketServer.on("connection", (socket) => {
        socket.send(JSON.stringify({
            type: "hello",
            message: "connected",
            serverTime: new Date().toISOString(),
        }));

        socket.on("message", (raw) => {
            try {
                const message = JSON.parse(raw.toString());
                if (message.type === "ping") {
                    socket.send(JSON.stringify({ type: "pong", clientTime: message.clientTime || null }));
                }
            } catch {
                // Ignore malformed client messages.
            }
        });
    });

    return webSocketServer;
}

function broadcast(payload) {
    if (!webSocketServer) return;
    const serialized = JSON.stringify(payload);
    webSocketServer.clients.forEach((client) => safeSend(client, serialized));
}

function broadcastChargerUpdate(charger, source = "sync") {
    if (!charger || typeof charger.id === "undefined" || charger.id === null) return;
    broadcast({
        type: "charger_update",
        source,
        charger,
        serverTime: new Date().toISOString(),
    });
}

function broadcastChargerDelete(chargerId, source = "admin") {
    if (!Number.isFinite(Number(chargerId))) return;
    broadcast({
        type: "charger_delete",
        source,
        chargerId: Number(chargerId),
        serverTime: new Date().toISOString(),
    });
}

module.exports = {
    initRealtime,
    broadcastChargerUpdate,
    broadcastChargerDelete,
};