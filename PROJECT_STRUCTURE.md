# 项目结构说明

## 📁 项目目录结构

```
smc/
├── README.md                    # 主要文档
├── OKX_SETUP_GUIDE.md          # OKX详细设置指南
├── PROJECT_STRUCTURE.md        # 项目结构说明（本文件）
├── package.json                # 项目依赖和脚本
├── .env.example                # 环境变量示例
├── server.js                   # 主服务器文件
├── test_okx_connection.js      # OKX连接测试脚本
│
├── src/                        # 源代码目录
│   ├── binanceTrader.js        # Binance交易器
│   ├── okxTrader.js           # OKX交易器
│   ├── signalValidator.js     # 通用信号验证器
│   ├── okxSignalValidator.js  # OKX专用信号验证器
│   ├── orderManager.js        # 订单管理器
│   └── errorHandler.js        # 错误处理器
│
└── tradingview/               # TradingView策略
    ├── smc_strategy.pine      # 完整SMC策略
    └── okx_smc_simple.pine    # 简化版OKX SMC策略
```

## 🔧 核心组件说明

### 1. 服务器层 (server.js)
- **Express服务器**: 处理HTTP请求和Webhook
- **中间件**: 安全验证、日志记录、错误处理
- **路由**: API端点和Webhook端点
- **交易器选择**: 根据环境变量选择Binance或OKX

### 2. 交易器层 (src/)
- **BinanceTrader**: 币安交易所交易执行
- **OKXTrader**: OKX交易所交易执行
- **统一接口**: 两个交易器实现相同的接口方法

### 3. 验证器层 (src/)
- **SignalValidator**: 通用信号验证（支持Binance）
- **OKXSignalValidator**: OKX专用信号验证
- **业务逻辑验证**: SMC策略特定的验证规则

### 4. TradingView策略 (tradingview/)
- **完整策略**: 包含所有SMC组件的完整版本
- **简化策略**: 专门为OKX优化的简化版本
- **Webhook集成**: 自动发送交易信号到服务器

## 🚀 工作流程

### 1. 信号生成流程
```
TradingView图表 → Pine Script策略 → 信号检测 → Webhook发送
```

### 2. 信号处理流程
```
Webhook接收 → 信号验证 → 风险管理检查 → 交易执行 → 结果返回
```

### 3. 交易执行流程
```
信号验证通过 → 选择交易器 → 计算仓位大小 → 执行订单 → 设置止损止盈
```

## 🔑 配置说明

### 环境变量
- `TRADING_EXCHANGE`: 选择交易所 (binance/okx)
- `OKX_API_KEY/SECRET/PASSPHRASE`: OKX API配置
- `BINANCE_API_KEY/SECRET`: Binance API配置
- `MAX_RISK_PER_TRADE`: 单笔交易风险限制

### 交易器选择
```javascript
// 在server.js中
const selectedTrader = process.env.TRADING_EXCHANGE === 'okx' ? okxTrader : binanceTrader;
const selectedValidator = isOKX ? okxSignalValidator : signalValidator;
```

## 📊 SMC策略组件

### 1. 订单区块 (Order Blocks)
- **检测**: 强势移动后的回调区域
- **用途**: 入场点和止损参考
- **实现**: Pine Script中的订单区块检测算法

### 2. 公允价值缺口 (Fair Value Gap)
- **检测**: 三根K线的价格缺口
- **用途**: 价格回填目标
- **实现**: FVG检测和回填逻辑

### 3. 流动性测试 (Liquidity Sweep)
- **检测**: 突破关键水平后反转
- **用途**: 确认方向转换
- **实现**: 流动性水平突破检测

## 🛡 风险管理

### 1. 多层风险控制
- **单笔风险**: 限制每笔交易风险百分比
- **日风险控制**: 限制每日总风险敞口
- **持仓限制**: 限制同时持仓数量
- **动态止损**: 基于ATR的动态止损

### 2. 信号验证
- **格式验证**: Joi schema验证
- **业务逻辑验证**: SMC策略特定验证
- **交易所特定验证**: 不同交易所的格式要求

## 🔄 API接口

### Webhook端点
- `POST /webhook/tradingview`: 接收TradingView信号

### 监控端点
- `GET /health`: 健康检查
- `GET /api/positions`: 获取持仓
- `GET /api/balance`: 获取余额
- `POST /api/close-all`: 关闭所有持仓

## 📝 日志系统

### 日志文件
- `logs/combined.log`: 完整日志
- `logs/error.log`: 错误日志
- `logs/binance.log`: Binance交易日志
- `logs/okx.log`: OKX交易日志

### 日志级别
- `info`: 一般信息
- `warn`: 警告信息
- `error`: 错误信息
- `debug`: 调试信息

## 🧪 测试

### 连接测试
```bash
npm run test:okx      # 测试OKX连接
npm run test:binance  # 测试Binance连接
```

### 测试内容
- API连接测试
- 账户余额获取
- 持仓信息获取
- 价格数据获取
- 信号验证测试

## 📈 扩展性

### 添加新交易所
1. 创建新的交易器类（实现统一接口）
2. 创建对应的信号验证器
3. 在server.js中添加选择逻辑
4. 更新环境变量配置

### 添加新策略
1. 创建新的Pine Script策略
2. 在验证器中添加策略特定验证
3. 在交易器中添加策略特定处理

## 🔒 安全考虑

### API密钥安全
- 使用环境变量存储敏感信息
- IP白名单限制
- 定期轮换API密钥

### 网络安全
- Webhook IP验证
- 自定义密钥验证
- HTTPS传输

### 资金安全
- 限制API权限（不启用提币）
- 风险参数限制
- 实时监控和告警

## 📚 文档结构

- **README.md**: 主要使用文档
- **OKX_SETUP_GUIDE.md**: OKX详细设置指南
- **PROJECT_STRUCTURE.md**: 项目结构说明
- **代码注释**: 详细的代码内注释

## 🚀 部署建议

### 开发环境
```bash
npm run dev  # 使用nodemon自动重启
```

### 生产环境
```bash
npm start    # 直接运行
# 或使用PM2
pm2 start server.js --name "smc-bot"
```

### 监控
- 日志监控
- 性能监控
- 错误告警
- 交易监控