// server.js
const WebSocket = require('ws');
const { setupWSConnection } = require('y-websocket');
const jwt = require('jsonwebtoken');
const url = require('url');
const http = require('http');
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
});

wss.on('headers', (headers, req) => {
    // 添加安全相关的HTTP头
    headers.push('Strict-Transport-Security: max-age=63072000; includeSubDomains; preload');
    headers.push('X-Content-Type-Options: nosniff');
    headers.push('X-Frame-Options: DENY');
});

// 连接统计
let connectionCount = 0;


// 增强的心跳检测机制
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((client) => {
        if (client.readyState !== WebSocket.OPEN) return;

        if (client.isAlive === false) {
            console.log(`[${new Date().toISOString()}] 终止无响应的连接: ${client.id}`);
            return client.terminate();
        }

        client.isAlive = false;
        client.ping(null, false, (err) => {
            if (err) console.error(`[${client.id}] Ping失败:`, err.message);
        });
    });
}, 30000); // 每30秒检测一次

// 连接关闭时清理资源
wss.on('close', () => {
    clearInterval(heartbeatInterval);
    console.log('WebSocket服务器已关闭');
});

// 增强的JWT验证函数
const verifyToken = (token) => {
    try {
        return jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        // 特殊处理过期token
        if (error.name === 'TokenExpiredError') {
            console.warn(`Token已过期: ${token.substring(0, 20)}...`);
            return null;
        }

        // 处理无效token
        console.error(`无效Token: ${error.message} | Token: ${token.substring(0, 20)}...`);
        return null;
    }
};

// 高级连接处理器
const handleConnection = (ws, req) => {
    const connectionId = `conn-${++connectionCount}`;
    ws.id = connectionId;
    ws.isAlive = true;

    console.log(`[${new Date().toISOString()}] 收到新连接: ${connectionId}`);

    // 连接元数据
    const metadata = {
        ip: req.socket.remoteAddress,
        ua: req.headers['user-agent'] || '未知',
        room: null,
        user: null,
        connectedAt: new Date()
    };

    // 解析 URL 和查询参数
    const parsedUrl = url.parse(req.url, true);
    const token = parsedUrl.query.token;
    const room = parsedUrl.query.room;

    // 验证必需参数
    if (!token || !room) {
        const errorMsg = !token ? '缺少认证令牌' : '缺少房间参数';
        console.error(`[${connectionId}] 参数错误: ${errorMsg}`);
        ws.close(1008, errorMsg);
        return;
    }

    metadata.room = room;

    // 验证 JWT
    const decoded = verifyToken(token);
    if (!decoded) {
        console.error(`[${connectionId}] 认证失败`);
        ws.close(1008, '认证失败');
        return;
    }

    metadata.user = {
        email: decoded.email || '未知',
        id: decoded.sub || '未知'
    };

    console.log(`[${connectionId}] 认证成功: 用户 ${metadata.user.email} | 房间 ${room}`);

    // 设置 Yjs WebSocket 连接
    try {
        setupWSConnection(ws, req, {
            room: room,
            gc: true,
            awareness: new (require('y-protocols/awareness').Awareness)(new (require('yjs').Doc)())
        });

        console.log(`[${connectionId}] Yjs连接已建立`);
    } catch (error) {
        console.error(`[${connectionId}] Yjs设置失败: ${error.message}`);
        ws.close(1011, '服务器错误');
        return;
    }

    // 心跳响应
    ws.on('pong', () => {
        ws.isAlive = true;
        console.log(`[${connectionId}] 心跳响应`);
    });

    // 错误处理
    ws.on('error', (error) => {
        console.error(`[${connectionId}] 连接错误: ${error.message}`);
    });

    // 关闭连接处理
    ws.on('close', (code, reason) => {
        const duration = Math.round((new Date() - metadata.connectedAt) / 1000);
        console.log(`[${connectionId}] 连接关闭: ${code} - ${reason.toString()} | 持续时间: ${duration}秒`);
    });
};

// 高级错误处理中间件
wss.on('connection', (ws, req) => {
    try {
        handleConnection(ws, req);
    } catch (error) {
        console.error(`未处理的连接错误: ${error.message}`);
        if (ws.readyState === WebSocket.OPEN) {
            ws.close(1011, '服务器错误');
        }
    }
});

// 增强的服务器启动
server.listen(PORT, () => {
    console.log(`[${new Date().toISOString()}] HTTP服务器运行中: http://localhost:${PORT}`);
    console.log(`[${new Date().toISOString()}] WebSocket服务器运行中: ws://localhost:${PORT}/collaboration`);
    console.log(`[${new Date().toISOString()}] JWT密钥: ${process.env.JWT_SECRET.substring(0, 10)}...`);
});

// 优雅关闭 - 支持多种信号
const shutdownSignals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
shutdownSignals.forEach(signal => {
    process.on(signal, () => {
        console.log(`\n[${new Date().toISOString()}] 收到 ${signal} 信号，正在关闭服务器...`);

        // 关闭所有客户端连接
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.close(1001, '服务器关闭');
            }
        });

        // 关闭服务器
        wss.close(() => {
            server.close(() => {
                console.log(`[${new Date().toISOString()}] 服务器已优雅关闭`);
                process.exit(0);
            });
        });

        // 超时强制关闭
        setTimeout(() => {
            console.error(`[${new Date().toISOString()}] 强制关闭服务器`);
            process.exit(1);
        }, 10000);
    });
});

// 未捕获异常处理
process.on('uncaughtException', (error) => {
    console.error(`[${new Date().toISOString()}] 未捕获异常: ${error.message}`);
    console.error(error.stack);
});

// 未处理的Promise拒绝
process.on('unhandledRejection', (reason, promise) => {
    console.error(`[${new Date().toISOString()}] 未处理的Promise拒绝:`, reason);
});