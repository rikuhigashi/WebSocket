const WebSocket = require('ws');
const { setupWSConnection } = require('y-websocket');

const wss = new WebSocket.Server({ port: 1234 });

wss.on('connection', (ws, request) => {
    setupWSConnection(ws, request);
});

console.log('Yjs WebSocket 服务器运行在 ws://localhost:1234');