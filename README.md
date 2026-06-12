# ZTE U50S 调试后台

本工具是本地运行的 ZTE MU5002/U50S WebUI 调试后台。浏览器只访问本机页面，后端代理访问 `http://192.168.0.1`。

## 启动

```bash
npm start
```

默认地址：

```text
http://127.0.0.1:5178
```

可选环境变量：

```bash
ROUTER_BASE_URL=http://192.168.0.1 PORT=5178 HOST=127.0.0.1 npm start
```

开启后端调试日志：

```bash
ZTE_DEBUG=1 npm start
```

调试日志只输出到 Node.js 控制台，默认关闭。开启后会记录本地 API 请求、路由器 goform 请求/响应和自动重登状态；密码、Cookie、AD、LD、RD、token 等敏感字段会自动脱敏。

## 安全边界

- 登录密码只用于当前后端进程，不写入文件。
- 锁频、5G 锁小区、温控切换请求必须由前端二次确认，并且后端要求 `confirmed: true`。
- v1 实现实时网络信息、4G 锁频、5G 锁频、5G 小区锁定/解锁和温控切换，不实现 APN、重启、恢复出厂。

## 桌面版

安装依赖后可用 Electron 开发模式：

```bash
npm install
npm run electron:dev
```

打包桌面应用（产物在 `dist/` 目录）：

```bash
npm run dist:mac    # macOS: DMG + ZIP
npm run dist:win    # Windows: NSIS 安装包 + 便携版
npm run dist        # 当前平台
```

打包产物无需安装 Node.js，直接运行即可。路由器地址在登录页输入，默认 `192.168.0.1`。
