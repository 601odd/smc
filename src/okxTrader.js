const axios = require('axios');
const crypto = require('crypto');
const winston = require('winston');

// 配置日志
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'okx-trader' },
  transports: [
    new winston.transports.File({ filename: 'logs/okx.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

class OKXTrader {
  constructor() {
    this.isTestnet = process.env.OKX_TESTNET === 'true';
    this.apiKey = process.env.OKX_API_KEY;
    this.secretKey = process.env.OKX_SECRET_KEY;
    this.passphrase = process.env.OKX_PASSPHRASE;
    
    // OKX API 配置
    this.baseURL = this.isTestnet 
      ? 'https://www.okx.com'  // OKX没有公开的测试网API
      : 'https://www.okx.com';
    
    this.wsBaseURL = this.isTestnet 
      ? 'wss://ws.okx.com:8443/ws/v5/public'
      : 'wss://ws.okx.com:8443/ws/v5/public';

    // 活跃订单跟踪
    this.activeOrders = new Map();
    
    // 风险管理设置
    this.riskSettings = {
      maxRiskPerTrade: parseFloat(process.env.MAX_RISK_PER_TRADE) || 1, // 1%
      maxDailyRisk: parseFloat(process.env.MAX_DAILY_RISK) || 5, // 5%
      maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS) || 3,
      defaultLeverage: parseInt(process.env.DEFAULT_LEVERAGE) || 10
    };

    logger.info('OKXTrader initialized', { 
      testnet: this.isTestnet,
      riskSettings: this.riskSettings 
    });
  }

  /**
   * 生成OKX API签名
   * @param {string} timestamp - 时间戳
   * @param {string} method - HTTP方法
   * @param {string} requestPath - 请求路径
   * @param {string} body - 请求体
   * @returns {string} 签名字符串
   */
  generateSignature(timestamp, method, requestPath, body = '') {
    const message = timestamp + method.toUpperCase() + requestPath + body;
    return crypto.createHmac('sha256', this.secretKey).update(message).digest('base64');
  }

  /**
   * 创建API请求头
   * @param {string} method - HTTP方法
   * @param {string} requestPath - 请求路径
   * @param {Object} body - 请求体
   * @returns {Object} 请求头
   */
  createHeaders(method, requestPath, body = null) {
    const timestamp = new Date().toISOString();
    const bodyStr = body ? JSON.stringify(body) : '';
    const signature = this.generateSignature(timestamp, method, requestPath, bodyStr);

    return {
      'OK-ACCESS-KEY': this.apiKey,
      'OK-ACCESS-SIGN': signature,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': this.passphrase,
      'Content-Type': 'application/json'
    };
  }

  /**
   * 发送API请求
   * @param {string} method - HTTP方法
   * @param {string} endpoint - API端点
   * @param {Object} data - 请求数据
   * @returns {Object} API响应
   */
  async makeRequest(method, endpoint, data = null) {
    try {
      const url = `${this.baseURL}${endpoint}`;
      const headers = this.createHeaders(method, endpoint, data);

      const config = {
        method,
        url,
        headers,
        timeout: 10000
      };

      if (data && (method === 'POST' || method === 'PUT')) {
        config.data = data;
      }

      const response = await axios(config);
      
      if (response.data.code !== '0') {
        throw new Error(`OKX API Error: ${response.data.msg} (${response.data.code})`);
      }

      return response.data;

    } catch (error) {
      logger.error('OKX API request failed', { 
        method, 
        endpoint, 
        error: error.message,
        response: error.response?.data 
      });
      throw error;
    }
  }

  /**
   * 处理TradingView信号
   * @param {Object} signal - 验证后的交易信号
   * @returns {Object} 交易结果
   */
  async processSignal(signal) {
    try {
      logger.info('Processing OKX signal', { signal });

      // 检查风险管理
      const riskCheck = await this.checkRiskManagement(signal);
      if (!riskCheck.allowed) {
        throw new Error(`Risk management violation: ${riskCheck.reason}`);
      }

      // 根据信号类型处理
      switch (signal.action) {
        case 'buy':
        case 'sell':
          return await this.openPosition(signal);
        case 'close':
          return await this.closePosition(signal);
        default:
          throw new Error(`Unsupported action: ${signal.action}`);
      }

    } catch (error) {
      logger.error('Error processing signal', { error: error.message, signal });
      throw error;
    }
  }

  /**
   * 开仓操作
   * @param {Object} signal - 交易信号
   * @returns {Object} 订单结果
   */
  async openPosition(signal) {
    try {
      // 获取当前市场价格
      const ticker = await this.getTicker(signal.symbol);
      const currentPrice = parseFloat(ticker.last);

      // 计算仓位大小
      const positionSize = await this.calculatePositionSize(signal, currentPrice);

      // 设置杠杆（期货交易）
      if (signal.leverage) {
        await this.setLeverage(signal.symbol, signal.leverage);
      }

      // 构建订单参数
      const orderParams = {
        instId: signal.symbol,
        tdMode: 'cross', // 全仓模式
        side: signal.action === 'buy' ? 'buy' : 'sell',
        ordType: signal.orderType === 'market' ? 'market' : 'limit',
        sz: positionSize.toString()
      };

      // 限价单需要价格
      if (signal.orderType === 'limit' && signal.price) {
        orderParams.px = signal.price.toString();
      }

      // 期货交易参数
      if (this.isFuturesSymbol(signal.symbol)) {
        orderParams.tdMode = 'cross'; // 全仓模式
      }

      // 执行主订单
      logger.info('Placing OKX order', { orderParams });
      const order = await this.placeOrder(orderParams);

      // 设置止损止盈
      if (order.state === 'filled') {
        await this.setStopLossAndTakeProfit(signal, order);
      }

      // 记录活跃订单
      this.activeOrders.set(order.ordId, {
        signal,
        order,
        timestamp: Date.now()
      });

      logger.info('OKX order executed successfully', { orderId: order.ordId });

      return {
        orderId: order.ordId,
        symbol: signal.symbol,
        action: signal.action,
        quantity: positionSize,
        price: order.avgPx || currentPrice,
        status: order.state
      };

    } catch (error) {
      logger.error('Error opening position', { error: error.message, signal });
      throw error;
    }
  }

  /**
   * 平仓操作
   * @param {Object} signal - 平仓信号
   * @returns {Object} 平仓结果
   */
  async closePosition(signal) {
    try {
      // 获取当前持仓
      const positions = await this.getPositions(signal.symbol);
      
      if (positions.length === 0) {
        throw new Error(`No open positions found for ${signal.symbol}`);
      }

      const results = [];

      for (const position of positions) {
        if (parseFloat(position.pos) !== 0) {
          const closeOrderParams = {
            instId: signal.symbol,
            tdMode: 'cross',
            side: parseFloat(position.pos) > 0 ? 'sell' : 'buy',
            ordType: 'market',
            sz: Math.abs(parseFloat(position.pos)).toString(),
            reduceOnly: true
          };

          const closeOrder = await this.placeOrder(closeOrderParams);
          results.push(closeOrder);

          logger.info('Position closed', { 
            symbol: signal.symbol, 
            orderId: closeOrder.ordId 
          });
        }
      }

      return {
        action: 'close',
        symbol: signal.symbol,
        orders: results
      };

    } catch (error) {
      logger.error('Error closing position', { error: error.message, signal });
      throw error;
    }
  }

  /**
   * 计算仓位大小
   * @param {Object} signal - 交易信号
   * @param {number} currentPrice - 当前价格
   * @returns {number} 仓位大小
   */
  async calculatePositionSize(signal, currentPrice) {
    try {
      const balance = await this.getBalance();
      const availableBalance = parseFloat(balance.availBal);

      let positionValue;

      if (signal.positionSizeType === 'fixed' && signal.positionSize) {
        // 固定金额
        positionValue = signal.positionSize;
      } else if (signal.positionSizeType === 'percentage' && signal.positionSize) {
        // 百分比
        positionValue = (availableBalance * signal.positionSize) / 100;
      } else {
        // 基于风险百分比计算
        const riskAmount = (availableBalance * signal.riskPercent) / 100;
        
        if (signal.stopLoss && signal.price) {
          // 基于止损距离计算仓位大小
          const stopDistance = Math.abs(signal.price - signal.stopLoss);
          const riskPerUnit = stopDistance / signal.price;
          positionValue = riskAmount / riskPerUnit;
        } else {
          // 默认风险计算
          positionValue = riskAmount * 10; // 假设10倍杠杆
        }
      }

      // 应用杠杆
      if (signal.leverage) {
        positionValue *= signal.leverage;
      }

      // 计算数量
      const quantity = positionValue / currentPrice;

      // 获取交易规则并调整精度
      const instrumentInfo = await this.getInstrumentInfo(signal.symbol);
      const adjustedQuantity = this.adjustQuantityPrecision(quantity, instrumentInfo);

      logger.info('Position size calculated', {
        symbol: signal.symbol,
        availableBalance,
        positionValue,
        quantity: adjustedQuantity
      });

      return adjustedQuantity;

    } catch (error) {
      logger.error('Error calculating position size', { error: error.message });
      throw error;
    }
  }

  /**
   * 设置止损止盈
   * @param {Object} signal - 交易信号
   * @param {Object} mainOrder - 主订单
   */
  async setStopLossAndTakeProfit(signal, mainOrder) {
    try {
      const quantity = parseFloat(mainOrder.sz);

      // 设置止损
      if (signal.stopLoss) {
        const stopLossParams = {
          instId: signal.symbol,
          tdMode: 'cross',
          side: signal.action === 'buy' ? 'sell' : 'buy',
          ordType: 'conditional',
          sz: quantity.toString(),
          slTriggerPx: signal.stopLoss.toString(),
          slOrdPx: '-1', // 市价止损
          reduceOnly: true
        };

        const stopLossOrder = await this.placeOrder(stopLossParams);
        logger.info('Stop loss set', { orderId: stopLossOrder.ordId });
      }

      // 设置止盈
      if (signal.takeProfit) {
        const takeProfitParams = {
          instId: signal.symbol,
          tdMode: 'cross',
          side: signal.action === 'buy' ? 'sell' : 'buy',
          ordType: 'limit',
          sz: quantity.toString(),
          px: signal.takeProfit.toString(),
          reduceOnly: true
        };

        const takeProfitOrder = await this.placeOrder(takeProfitParams);
        logger.info('Take profit set', { orderId: takeProfitOrder.ordId });
      }

    } catch (error) {
      logger.error('Error setting stop loss/take profit', { error: error.message });
      // 不抛出错误，因为主订单已经成功
    }
  }

  /**
   * 下单
   * @param {Object} orderParams - 订单参数
   * @returns {Object} 订单结果
   */
  async placeOrder(orderParams) {
    const response = await this.makeRequest('POST', '/api/v5/trade/order', orderParams);
    return response.data[0];
  }

  /**
   * 设置杠杆
   * @param {string} symbol - 交易对
   * @param {number} leverage - 杠杆倍数
   */
  async setLeverage(symbol, leverage) {
    if (this.isFuturesSymbol(symbol)) {
      try {
        await this.makeRequest('POST', '/api/v5/account/set-leverage', {
          instId: symbol,
          lever: leverage.toString(),
          mgnMode: 'cross'
        });
        logger.info('Leverage set', { symbol, leverage });
      } catch (error) {
        logger.warn('Failed to set leverage', { symbol, leverage, error: error.message });
      }
    }
  }

  /**
   * 获取持仓
   * @param {string} symbol - 可选的特定交易对
   * @returns {Array} 持仓列表
   */
  async getPositions(symbol = null) {
    try {
      const response = await this.makeRequest('GET', '/api/v5/account/positions');
      let positions = response.data.filter(pos => parseFloat(pos.pos) !== 0);

      if (symbol) {
        positions = positions.filter(pos => pos.instId === symbol);
      }

      return positions;
    } catch (error) {
      logger.error('Error fetching positions', { error: error.message });
      return [];
    }
  }

  /**
   * 获取账户余额
   * @returns {Object} 余额信息
   */
  async getBalance() {
    try {
      const response = await this.makeRequest('GET', '/api/v5/account/balance');
      const accountData = response.data[0];
      
      return {
        totalWalletBalance: accountData.totalEq,
        availableBalance: accountData.availEq,
        totalUnrealizedProfit: accountData.totalUnrealizedPnl
      };
    } catch (error) {
      logger.error('Error fetching balance', { error: error.message });
      throw error;
    }
  }

  /**
   * 获取当前价格
   * @param {string} symbol - 交易对
   * @returns {Object} 价格信息
   */
  async getTicker(symbol) {
    try {
      const response = await this.makeRequest('GET', `/api/v5/market/ticker?instId=${symbol}`);
      return response.data[0];
    } catch (error) {
      logger.error('Error fetching ticker', { error: error.message });
      throw error;
    }
  }

  /**
   * 获取交易工具信息
   * @param {string} symbol - 交易对
   * @returns {Object} 工具信息
   */
  async getInstrumentInfo(symbol) {
    try {
      const response = await this.makeRequest('GET', `/api/v5/public/instruments?instId=${symbol}`);
      return response.data[0];
    } catch (error) {
      logger.error('Error fetching instrument info', { error: error.message });
      return null;
    }
  }

  /**
   * 关闭所有持仓
   * @returns {Array} 关闭结果
   */
  async closeAllPositions() {
    try {
      const positions = await this.getPositions();
      const results = [];

      for (const position of positions) {
        if (parseFloat(position.pos) !== 0) {
          const closeParams = {
            instId: position.instId,
            tdMode: 'cross',
            side: parseFloat(position.pos) > 0 ? 'sell' : 'buy',
            ordType: 'market',
            sz: Math.abs(parseFloat(position.pos)).toString(),
            reduceOnly: true
          };

          const result = await this.placeOrder(closeParams);
          results.push(result);
        }
      }

      logger.info('All positions closed', { count: results.length });
      return results;
    } catch (error) {
      logger.error('Error closing all positions', { error: error.message });
      throw error;
    }
  }

  /**
   * 风险管理检查
   * @param {Object} signal - 交易信号
   * @returns {Object} 风险检查结果
   */
  async checkRiskManagement(signal) {
    try {
      // 检查最大持仓数量
      const positions = await this.getPositions();
      if (positions.length >= this.riskSettings.maxOpenPositions) {
        return {
          allowed: false,
          reason: `Maximum open positions exceeded (${this.riskSettings.maxOpenPositions})`
        };
      }

      // 检查单笔交易风险
      if (signal.riskPercent > this.riskSettings.maxRiskPerTrade) {
        return {
          allowed: false,
          reason: `Risk per trade too high (${signal.riskPercent}% > ${this.riskSettings.maxRiskPerTrade}%)`
        };
      }

      return { allowed: true };
    } catch (error) {
      logger.error('Risk management check failed', { error: error.message });
      return { allowed: false, reason: 'Risk management check failed' };
    }
  }

  /**
   * 调整数量精度
   * @param {number} quantity - 原始数量
   * @param {Object} instrumentInfo - 工具信息
   * @returns {number} 调整后数量
   */
  adjustQuantityPrecision(quantity, instrumentInfo) {
    if (!instrumentInfo) return quantity;

    const lotSz = parseFloat(instrumentInfo.lotSz);
    if (lotSz) {
      return Math.floor(quantity / lotSz) * lotSz;
    }

    return quantity;
  }

  /**
   * 判断是否为期货交易对
   * @param {string} symbol - 交易对
   * @returns {boolean} 是否为期货
   */
  isFuturesSymbol(symbol) {
    // OKX期货交易对通常以SWAP结尾
    return symbol.includes('SWAP') || symbol.includes('-');
  }
}

module.exports = OKXTrader;