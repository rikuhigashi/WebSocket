// server.js
const WebSocket = require('ws');
const {setupWSConnection} = require('y-websocket');
const jwt = require('jsonwebtoken');
const url = require('url'); // 用于正确解析 URL
const http = require('http'); // 用于创建 HTTP 服务器
require('dotenv').config();

// 从环境变量获取端口，默认为 1234
const PORT = process.env.PORT || 1234;

// 创建 HTTP 服务器用于健康检查
const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({
            status: 'ok',
            clients: wss.clients.size,
            uptime: process.uptime()
        }));
        return;
    }

    res.writeHead(404);
    res.end();
});

// 创建 WebSocket 服务器
const wss = new WebSocket.Server({
    server,
    path: '/collaboration'
})
// 连接统计
let connectionCount = 0;

// 心跳检测机制
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((client) => {
        if (client.isAlive === false) {
            console.log(`终止无响应的连接: ${client.id}`);
            return client.terminate();
        }

        client.isAlive = false;
        client.ping(() => {
        });
    });
}, 30000); // 每30秒检测一次

// 连接关闭时清理资源
wss.on('close', () => {
    clearInterval(heartbeatInterval);
});

// 处理新连接
wss.on('connection', (ws, req) => {
    try {
        // 为连接生成唯一ID
        ws.id = `conn-${++connectionCount}`;
        ws.isAlive = true;

        // 监听 pong 响应
        ws.on('pong', () => {
            ws.isAlive = true;
            console.log(`心跳响应: ${ws.id}`);
        });

        // 解析 URL 和查询参数
        const parsedUrl = url.parse(req.url, true);
        const token = parsedUrl.query.token;
        const room = parsedUrl.query.room; //

        if (!token) {
            throw new Error('未提供认证令牌');
        }

        // 验证 JWT
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log(`新连接 [${ws.id}]: 用户 ${decoded.email} 房间 ${room}`);

        // 设置 Yjs WebSocket 连接，传递房间名
        setupWSConnection(ws, req, { room });

        // 错误处理
        ws.on('error', (error) => {
            console.error(`连接错误 [${ws.id}]: ${error.message}`);
        });

        // 关闭连接处理
        ws.on('close', (code, reason) => {
            console.log(`连接关闭 [${ws.id}]: ${code} - ${reason}`);
        });

    } catch (error) {
        console.error(`认证失败: ${error.message}`);
        ws.close(1008, '认证失败');
    }
});

// 启动服务器
server.listen(PORT, () => {
    console.log(`HTTP 服务器运行在 http://localhost:${PORT}`);
    console.log(`WebSocket 服务器运行在 ws://localhost:${PORT}/collaboration`);
});

// 优雅关闭
process.on('SIGINT', () => {
    console.log('正在关闭服务器...');

    // 关闭所有客户端连接
    wss.clients.forEach(client => {
        client.close(1001, '服务器关闭');
    });

    // 关闭服务器
    wss.close(() => {
        server.close(() => {
            console.log('服务器已关闭');
            process.exit(0);
        });
    });
});