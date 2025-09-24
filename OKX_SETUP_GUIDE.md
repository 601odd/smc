# OKX SMC 交易策略设置指南

本指南将帮助你在OKX交易所上设置基于Smart Money Concept (SMC)策略的自动化交易机器人。

## 🚀 快速开始

### 1. OKX API 配置

#### 步骤 1: 创建OKX账户
1. 访问 [OKX官网](https://www.okx.com) 注册账户
2. 完成KYC验证
3. 启用API交易功能

#### 步骤 2: 创建API密钥
1. 登录OKX账户，进入 **API管理** 页面
2. 点击 **创建API密钥**
3. 设置API密钥权限：
   - ✅ 读取权限
   - ✅ 交易权限
   - ❌ 提币权限（安全考虑）
4. 设置IP白名单（推荐）
5. 记录以下信息：
   - API Key
   - Secret Key
   - Passphrase

#### 步骤 3: 配置环境变量
复制 `.env.example` 到 `.env` 并填入你的配置：

```env
# 选择OKX作为交易交易所
TRADING_EXCHANGE=okx

# OKX API配置
OKX_API_KEY=your_okx_api_key_here
OKX_SECRET_KEY=your_okx_secret_key_here
OKX_PASSPHRASE=your_okx_passphrase_here
OKX_TESTNET=false
```

### 2. TradingView 策略设置

#### 步骤 1: 导入Pine Script策略
1. 打开TradingView，进入Pine编辑器
2. 复制 `tradingview/okx_smc_simple.pine` 的内容
3. 粘贴到Pine编辑器
4. 点击 **添加到图表**

#### 步骤 2: 配置策略参数
在策略设置中调整以下参数：

```
风险管理:
- Risk per trade (%): 2.0  # 单笔交易风险
- Leverage: 10             # 杠杆倍数

SMC设置:
- Order Block Strength: 3  # 订单区块强度
- FVG Strength: 2          # FVG强度
- ATR Multiplier for SL/TP: 2.0  # 止损止盈倍数

信号过滤:
- Minimum Volume Ratio: 1.5  # 最小成交量比率
- Use Trend Filter: true     # 使用趋势过滤

Webhook设置:
- Enable Webhook Signals: true
- Webhook URL: http://your-server-ip:3000/webhook/tradingview
```

#### 步骤 3: 设置Webhook告警
1. 在TradingView图表上右键点击策略
2. 选择 **添加告警**
3. 配置告警设置：
   - **条件**: 策略信号
   - **操作**: Webhook URL
   - **URL**: `http://your-server-ip:3000/webhook/tradingview`
   - **消息**: 使用策略默认消息格式

### 3. 服务器部署

#### 步骤 1: 安装依赖
```bash
npm install
```

#### 步骤 2: 启动服务
```bash
# 开发模式
npm run dev

# 生产模式
npm start
```

#### 步骤 3: 验证部署
访问以下端点验证服务状态：
- 健康检查: `http://your-server-ip:3000/health`
- 账户余额: `http://your-server-ip:3000/api/balance`
- 当前持仓: `http://your-server-ip:3000/api/positions`

## 📊 SMC策略说明

### 核心概念

#### 1. 订单区块 (Order Blocks)
- **定义**: 机构大量订单聚集的价格区域
- **识别**: 强势移动后的回调区域
- **用法**: 作为入场和止损的参考点

#### 2. 公允价值缺口 (Fair Value Gap)
- **定义**: 价格快速移动留下的价格缺口
- **识别**: 三根K线中中间K线与前后K线不重叠的部分
- **用法**: 价格往往会回填这些缺口

#### 3. 流动性测试 (Liquidity Sweep)
- **定义**: 价格突破关键水平后快速反转
- **识别**: 突破前期高点/低点后立即反转
- **用法**: 确认市场方向转换

### 信号逻辑

#### 看涨信号条件
1. **基础条件**:
   - 价格在EMA9和EMA21之上
   - 成交量放大
   - 上升趋势确认

2. **SMC条件** (满足任一):
   - 测试看涨订单区块
   - 价格回填看涨FVG
   - 流动性测试后反弹

#### 看跌信号条件
1. **基础条件**:
   - 价格在EMA9和EMA21之下
   - 成交量放大
   - 下降趋势确认

2. **SMC条件** (满足任一):
   - 测试看跌订单区块
   - 价格回填看跌FVG
   - 流动性测试后回落

## 🛡 风险管理

### 自动风险控制
- **单笔风险**: 限制每笔交易的最大风险百分比
- **日风险控制**: 限制每日总风险敞口
- **最大持仓**: 限制同时持仓数量
- **动态止损**: 基于ATR的动态止损

### 手动风险控制
```bash
# 关闭所有持仓
curl -X POST http://your-server-ip:3000/api/close-all

# 查看当前持仓
curl http://your-server-ip:3000/api/positions

# 查看账户余额
curl http://your-server-ip:3000/api/balance
```

## 🔧 高级配置

### 自定义SMC参数
在 `.env` 文件中调整：

```env
# SMC策略参数
SMC_ORDER_BLOCK_LOOKBACK=20    # 订单区块回看周期
SMC_FVG_LOOKBACK=10           # FVG回看周期
SMC_LIQUIDITY_THRESHOLD=0.5   # 流动性测试阈值
SMC_ATR_MULTIPLIER=2.0        # ATR倍数
```

### 多时间框架分析
在Pine Script中启用高级时间框架分析：

```pine
use_htf_orderblocks = input.bool(true, "Use Higher Timeframe Order Blocks")
htf_timeframe = input.timeframe("4H", "Higher Timeframe for Order Blocks")
```

## 📈 性能优化

### 1. 信号过滤
- 使用成交量过滤避免假信号
- 启用趋势过滤提高信号质量
- 设置最小价格变动阈值

### 2. 执行优化
- 使用市价单确保快速执行
- 设置合理的订单超时时间
- 监控网络延迟

### 3. 监控指标
- 信号成功率
- 平均盈亏比
- 最大回撤
- 夏普比率

## 🚨 注意事项

### 安全提醒
1. **API密钥安全**:
   - 不要将API密钥提交到代码仓库
   - 使用IP白名单限制访问
   - 定期轮换API密钥

2. **资金安全**:
   - 先在测试环境验证策略
   - 使用小资金开始实盘交易
   - 设置合理的风险参数

3. **系统监控**:
   - 监控服务器运行状态
   - 检查日志文件
   - 设置异常告警

### 常见问题

#### Q: 为什么没有收到交易信号？
A: 检查以下项目：
- TradingView策略是否正确添加到图表
- Webhook URL是否正确配置
- 服务器是否正常运行
- 策略参数是否合适

#### Q: 订单执行失败怎么办？
A: 检查以下项目：
- OKX API密钥是否正确
- 账户余额是否充足
- 交易对是否支持
- 网络连接是否正常

#### Q: 如何调整策略参数？
A: 可以调整以下参数：
- 在TradingView策略设置中调整Pine Script参数
- 在服务器环境变量中调整风险管理参数
- 重新部署策略和服务器

## 📞 技术支持

如果遇到问题，请：

1. **查看日志文件**:
   ```bash
   tail -f logs/combined.log
   tail -f logs/error.log
   tail -f logs/okx.log
   ```

2. **检查API状态**:
   ```bash
   curl http://your-server-ip:3000/health
   ```

3. **验证配置**:
   ```bash
   curl http://your-server-ip:3000/api/balance
   ```

4. **联系支持**: 提交Issue或联系开发者

---

**⚡ 快速开始提示**: 
1. 先在OKX测试环境验证策略
2. 使用小资金开始实盘交易
3. 逐步优化参数设置
4. 持续监控交易表现