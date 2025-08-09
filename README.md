# SMC 自动交易机器人

基于 Smart Money Concept (SMC) 策略的自动化交易机器人，支持 TradingView 信号接收和 Binance 交易执行。

## 🚀 特性

- **TradingView 信号接收**: 通过 Webhook 接收 TradingView 发送的交易信号
- **Binance 自动交易**: 自动在 Binance 期货市场执行交易
- **SMC 策略支持**: 专为 Smart Money Concept 策略设计
- **风险管理**: 内置多层风险控制机制
- **实时监控**: 完整的订单跟踪和持仓管理
- **错误处理**: 智能错误处理和告警系统
- **日志记录**: 详细的交易日志和统计

## 📋 系统要求

- Node.js >= 14.0.0
- npm 或 yarn
- Binance 账户和 API 密钥
- TradingView Pro 账户（用于发送 Webhook）

## 🛠 安装

1. **克隆项目**
```bash
git clone <your-repo-url>
cd smc-trading-bot
```

2. **安装依赖**
```bash
npm install
```

3. **配置环境变量**
```bash
cp env.example .env
```

编辑 `.env` 文件，填入你的配置：

```env
# 服务器配置
PORT=3000
NODE_ENV=production

# Binance API 配置
BINANCE_API_KEY=your_binance_api_key_here
BINANCE_API_SECRET=your_binance_api_secret_here
BINANCE_TESTNET=false  # 生产环境设为 false

# TradingView Webhook 配置
VERIFY_TRADINGVIEW_IP=false         # 是否验证TradingView官方IP
TRADINGVIEW_CUSTOM_SECRET=your_custom_secret_here  # 可选的自定义密钥

# 风险管理配置
MAX_RISK_PER_TRADE=1.0         # 单笔交易最大风险百分比 (%)
MAX_DAILY_RISK=5.0             # 每日最大风险百分比 (%)
MAX_OPEN_POSITIONS=3           # 最大同时持仓数量
DEFAULT_LEVERAGE=10            # 默认杠杆倍数
```

## 🔑 Binance API 配置

1. **登录 Binance 账户**，进入 API 管理页面
2. **创建新的 API 密钥**
3. **设置 IP 白名单**（推荐）
4. **启用期货交易权限**
5. **复制 API Key 和 Secret** 到 `.env` 文件

⚠️ **安全提醒**:
- 不要在代码中硬编码 API 密钥
- 使用 IP 白名单限制访问
- 定期轮换 API 密钥
- 测试环境先使用 Testnet

## 📊 TradingView 配置

### 1. 创建 Webhook 告警

在 TradingView 中设置告警时：

1. **选择条件**: 设置你的 SMC 策略条件
2. **选择操作**: 选择 "Webhook URL"
3. **输入 URL**: `http://your-server-ip:3000/webhook/tradingview`
4. **配置消息**: 使用以下 JSON 格式

### 2. 信号格式

TradingView 发送的 JSON 格式：

```json
{
  "symbol": "BTCUSDT",
  "action": "buy",
  "price": 50000,
  "stopLoss": 49000,
  "takeProfit": 52000,
  "positionSize": 10,
  "positionSizeType": "percentage",
  "leverage": 10,
  "riskPercent": 1,
  "orderType": "market",
  "strategy": "SMC",
  "timeframe": "1h",
  "message": "SMC 看涨信号",
  "orderBlock": {
    "type": "bullish",
    "price": 49800,
    "timeframe": "4h"
  },
  "fairValueGap": {
    "upper": 50200,
    "lower": 49800,
    "timeframe": "1h"
  },
  "liquidityLevel": {
    "type": "buy_side",
    "price": 50500,
    "strength": "strong"
  }
}
```

### 3. 必填字段

- `symbol`: 交易对 (如 "BTCUSDT")
- `action`: 操作类型 ("buy", "sell", "close")

### 4. 可选字段

- `price`: 入场价格（限价单）
- `stopLoss`: 止损价格
- `takeProfit`: 止盈价格
- `positionSize`: 仓位大小
- `leverage`: 杠杆倍数
- `riskPercent`: 风险百分比

## 🚀 启动服务

### 开发模式
```bash
npm run dev
```

### 生产模式
```bash
npm start
```

服务启动后，你会看到：
```
🚀 SMC Trading Bot started on http://localhost:3000
📊 Health check: http://localhost:3000/health
🔗 Webhook URL: http://localhost:3000/webhook/tradingview
```

## 📡 API 端点

### Webhook 端点
- `POST /webhook/tradingview` - 接收 TradingView 信号

### 监控端点
- `GET /health` - 健康检查
- `GET /api/positions` - 获取当前持仓
- `GET /api/balance` - 获取账户余额

### 管理端点
- `POST /api/close-all` - 关闭所有持仓

## 🛡 风险管理

系统内置多层风险控制：

### 1. 交易风险控制
- **单笔交易风险**: 限制单笔交易最大风险百分比
- **日风险控制**: 限制每日总风险敞口
- **最大持仓数**: 限制同时持仓数量
- **杠杆控制**: 自动设置和管理杠杆

### 2. 订单验证
- **信号格式验证**: 验证 TradingView 信号格式
- **价格合理性检查**: 检查止损止盈价格逻辑
- **余额充足性验证**: 确保账户余额充足

### 3. 错误处理
- **自动重试**: 网络错误和临时失败自动重试
- **告警系统**: 关键错误实时告警
- **故障恢复**: 系统异常自动恢复

## 📊 监控和日志

### 日志文件
- `logs/combined.log` - 完整日志
- `logs/error.log` - 错误日志
- `logs/binance.log` - 交易日志
- `logs/orders.log` - 订单日志

### 监控指标
- 交易成功率
- 错误统计
- 持仓状况
- 盈亏统计

## 🧪 测试

### 使用 Binance Testnet
```env
BINANCE_TESTNET=true
```

### 测试 Webhook
```bash
curl -X POST http://localhost:3000/webhook/tradingview \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "BTCUSDT",
    "action": "buy",
    "price": 50000,
    "stopLoss": 49000,
    "takeProfit": 52000,
    "riskPercent": 1
  }'
```

## 🔧 部署

### 使用 PM2 (推荐)
```bash
npm install -g pm2
pm2 start server.js --name "smc-bot"
pm2 startup
pm2 save
```

### 使用 Docker
```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

## 📈 SMC 策略说明

本机器人专为 Smart Money Concept 策略设计，支持：

### 核心概念
- **Order Blocks**: 机构订单区块
- **Fair Value Gaps (FVG)**: 公允价值缺口
- **Liquidity Levels**: 流动性水平
- **Market Structure**: 市场结构

### 信号类型
- **趋势跟随**: 基于市场结构的趋势信号
- **反转信号**: 流动性捕获后的反转
- **突破信号**: 关键水平突破

### 风险管理
- **止损设置**: 基于市场结构的动态止损
- **止盈策略**: 多目标止盈
- **仓位管理**: 基于波动率的动态仓位

## ⚠️ 免责声明

- 本软件仅供学习和研究使用
- 加密货币交易存在高风险，可能导致资金损失
- 使用前请充分了解风险并在测试环境中验证
- 开发者不对任何交易损失承担责任

## 📞 支持

如有问题，请：
1. 查看日志文件排查问题
2. 检查 Binance API 配置
3. 验证 TradingView 信号格式
4. 提交 Issue 或联系开发者

## 📄 许可证

MIT License - 详见 LICENSE 文件

---

**⚡ 快速开始提示**: 
1. 先在 Testnet 环境测试
2. 小资金验证策略有效性
3. 逐步增加仓位规模
4. 持续监控和优化 
