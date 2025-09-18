const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');
const winston = require('winston');
const Joi = require('joi');
const crypto = require('crypto');

// 加载环境变量
dotenv.config();

// 配置日志
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'smc-trading-bot' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// 导入交易模块
const BinanceTrader = require('./src/binanceTrader');
const OKXTrader = require('./src/okxTrader');
const SignalValidator = require('./src/signalValidator');
const OKXSignalValidator = require('./src/okxSignalValidator');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(helmet());
app.use(cors());
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 初始化交易器
const binanceTrader = new BinanceTrader();
const okxTrader = new OKXTrader();
const signalValidator = new SignalValidator();
const okxSignalValidator = new OKXSignalValidator();

// 选择交易器和验证器（基于环境变量）
const isOKX = process.env.TRADING_EXCHANGE === 'okx';
const selectedTrader = isOKX ? okxTrader : binanceTrader;
const selectedValidator = isOKX ? okxSignalValidator : signalValidator;

// TradingView Webhook验证中间件
const verifyWebhook = (req, res, next) => {
  // TradingView不支持签名验证，所以我们使用其他安全措施
  
  // 1. 验证请求来源IP（可选）
  const allowedIPs = [
    '52.89.214.238',
    '34.212.75.30', 
    '54.218.53.128',
    '52.32.178.7'
  ];
  
  const clientIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
  logger.info('Webhook request from IP', { clientIP });
  
  // 如果配置了IP白名单验证
  if (process.env.VERIFY_TRADINGVIEW_IP === 'true') {
    if (!allowedIPs.includes(clientIP)) {
      logger.warn('Webhook request from unauthorized IP', { clientIP });
      return res.status(401).json({ error: 'Unauthorized IP address' });
    }
  }
  
  // 2. 验证请求格式
  if (!req.body) {
    logger.error('Empty webhook body');
    return res.status(400).json({ error: 'Empty request body' });
  }
  
  // 3. 可选的自定义密钥验证（在消息体中）
  const customSecret = process.env.TRADINGVIEW_CUSTOM_SECRET;
  if (customSecret && req.body.secret !== customSecret) {
    logger.warn('Invalid custom secret in webhook body');
    return res.status(401).json({ error: 'Invalid authentication' });
  }
  
  next();
};

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// TradingView Webhook端点
app.post('/webhook/tradingview', verifyWebhook, async (req, res) => {
  try {
    logger.info('Received TradingView signal', { body: req.body });

    // 验证信号格式
    const validationResult = selectedValidator.validate(req.body);
    if (validationResult.error) {
      logger.error('Signal validation failed', { error: validationResult.error.details });
      return res.status(400).json({ 
        error: 'Invalid signal format', 
        details: validationResult.error.details 
      });
    }

    const signal = validationResult.value;

    // 处理交易信号
    const result = await selectedTrader.processSignal(signal);
    
    logger.info('Signal processed successfully', { result });
    res.json({ 
      success: true, 
      message: 'Signal processed successfully',
      orderId: result.orderId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error processing signal', { error: error.message, stack: error.stack });
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});

// 获取当前持仓
app.get('/api/positions', async (req, res) => {
  try {
    const positions = await selectedTrader.getPositions();
    res.json(positions);
  } catch (error) {
    logger.error('Error fetching positions', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
});

// 获取账户余额
app.get('/api/balance', async (req, res) => {
  try {
    const balance = await selectedTrader.getBalance();
    res.json(balance);
  } catch (error) {
    logger.error('Error fetching balance', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

// 手动关闭所有订单
app.post('/api/close-all', async (req, res) => {
  try {
    const result = await selectedTrader.closeAllPositions();
    logger.info('All positions closed manually');
    res.json({ success: true, result });
  } catch (error) {
    logger.error('Error closing all positions', { error: error.message });
    res.status(500).json({ error: 'Failed to close positions' });
  }
});

// 错误处理中间件
app.use((error, req, res, next) => {
  logger.error('Unhandled error', { error: error.message, stack: error.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// 404处理
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// 优雅关闭
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// 启动服务器
app.listen(PORT, () => {
  logger.info(`SMC Trading Bot server running on port ${PORT}`);
  console.log(`🚀 SMC Trading Bot started on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 Webhook URL: http://localhost:${PORT}/webhook/tradingview`);
});

module.exports = app; 
