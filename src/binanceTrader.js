const Binance = require('binance-api-node').default;
const winston = require('winston');

// 配置日志
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'binance-trader' },
  transports: [
    new winston.transports.File({ filename: 'logs/binance.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

class BinanceTrader {
  constructor() {
    this.isTestnet = process.env.BINANCE_TESTNET === 'true';
    // 初始化Binance客户端
    this.client = Binance({
      apiKey: process.env.BINANCE_API_KEY,
      apiSecret: process.env.BINANCE_API_SECRET,
      httpBase: this.isTestnet ? 'https://testnet.binance.vision' : undefined,
      wsBase: this.isTestnet ? 'wss://testnet.binance.vision' : undefined,
      getTime: () => Date.now()
    });

    // 活跃订单跟踪
    this.activeOrders = new Map();
    
    // 风险管理设置
    this.riskSettings = {
      maxRiskPerTrade: parseFloat(process.env.MAX_RISK_PER_TRADE) || 1, // 1%
      maxDailyRisk: parseFloat(process.env.MAX_DAILY_RISK) || 5, // 5%
      maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS) || 3,
      defaultLeverage: parseInt(process.env.DEFAULT_LEVERAGE) || 10
    };

    logger.info('BinanceTrader initialized', { 
      testnet: this.isTestnet,
      riskSettings: this.riskSettings 
    });
  }

  /**
   * 处理TradingView信号
   * @param {Object} signal - 验证后的交易信号
   * @returns {Object} 交易结果
   */
  async processSignal(signal) {
    try {
      logger.info('Processing signal', { signal });

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
      const ticker = await this.client.prices({ symbol: signal.symbol });
      const currentPrice = parseFloat(ticker[signal.symbol]);

      // 计算仓位大小
      const positionSize = await this.calculatePositionSize(signal, currentPrice);

      // 设置杠杆（期货交易）
      if (signal.leverage) {
        await this.setLeverage(signal.symbol, signal.leverage);
      }

      // 构建订单参数
      const orderParams = {
        symbol: signal.symbol,
        side: signal.action.toUpperCase(),
        type: signal.orderType === 'market' ? 'MARKET' : 'LIMIT',
        quantity: positionSize.toString()
      };

      // 限价单需要价格
      if (signal.orderType === 'limit' && signal.price) {
        orderParams.price = signal.price.toString();
      }

      // 期货交易参数
      if (this.isFuturesSymbol(signal.symbol)) {
        orderParams.timeInForce = 'GTC';
        // 可以添加reduceOnly等期货特定参数
      }

      // 执行主订单
      logger.info('Placing order', { orderParams });
      const order = await this.placeOrder(orderParams);

      // 设置止损止盈
      if (order.status === 'FILLED') {
        await this.setStopLossAndTakeProfit(signal, order);
      }

      // 记录活跃订单
      this.activeOrders.set(order.orderId, {
        signal,
        order,
        timestamp: Date.now()
      });

      logger.info('Order executed successfully', { orderId: order.orderId });

      return {
        orderId: order.orderId,
        symbol: signal.symbol,
        action: signal.action,
        quantity: positionSize,
        price: order.fills ? order.fills[0]?.price : currentPrice,
        status: order.status
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
        if (Math.abs(parseFloat(position.positionAmt)) > 0) {
          const closeOrderParams = {
            symbol: signal.symbol,
            side: parseFloat(position.positionAmt) > 0 ? 'SELL' : 'BUY',
            type: 'MARKET',
            quantity: Math.abs(parseFloat(position.positionAmt)).toString()
          };

          if (this.isFuturesSymbol(signal.symbol)) {
            closeOrderParams.reduceOnly = true;
          }

          const closeOrder = await this.placeOrder(closeOrderParams);
          results.push(closeOrder);

          logger.info('Position closed', { 
            symbol: signal.symbol, 
            orderId: closeOrder.orderId 
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
      const availableBalance = parseFloat(balance.availableBalance || balance.totalWalletBalance);

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
      const exchangeInfo = await this.getExchangeInfo(signal.symbol);
      const adjustedQuantity = this.adjustQuantityPrecision(quantity, exchangeInfo);

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
      const quantity = parseFloat(mainOrder.executedQty);

      // 设置止损
      if (signal.stopLoss) {
        const stopLossParams = {
          symbol: signal.symbol,
          side: signal.action === 'buy' ? 'SELL' : 'BUY',
          type: 'STOP_MARKET',
          quantity: quantity.toString(),
          stopPrice: signal.stopLoss.toString()
        };

        if (this.isFuturesSymbol(signal.symbol)) {
          stopLossParams.reduceOnly = true;
        }

        const stopLossOrder = await this.placeOrder(stopLossParams);
        logger.info('Stop loss set', { orderId: stopLossOrder.orderId });
      }

      // 设置止盈
      if (signal.takeProfit) {
        const takeProfitParams = {
          symbol: signal.symbol,
          side: signal.action === 'buy' ? 'SELL' : 'BUY',
          type: 'LIMIT',
          quantity: quantity.toString(),
          price: signal.takeProfit.toString(),
          timeInForce: 'GTC'
        };

        if (this.isFuturesSymbol(signal.symbol)) {
          takeProfitParams.reduceOnly = true;
        }

        const takeProfitOrder = await this.placeOrder(takeProfitParams);
        logger.info('Take profit set', { orderId: takeProfitOrder.orderId });
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
    if (this.isFuturesSymbol(orderParams.symbol)) {
      return await this.client.futuresOrder(orderParams);
    } else {
      return await this.client.order(orderParams);
    }
  }

  /**
   * 设置杠杆
   * @param {string} symbol - 交易对
   * @param {number} leverage - 杠杆倍数
   */
  async setLeverage(symbol, leverage) {
    if (this.isFuturesSymbol(symbol)) {
      try {
        await this.client.futuresLeverage({
          symbol: symbol,
          leverage: leverage
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
      // 期货持仓
      const futuresPositions = await this.client.futuresPositionRisk();
      let positions = futuresPositions.filter(pos => parseFloat(pos.positionAmt) !== 0);

      if (symbol) {
        positions = positions.filter(pos => pos.symbol === symbol);
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
      const account = await this.client.futuresAccountInfo();
      return {
        totalWalletBalance: account.totalWalletBalance,
        availableBalance: account.availableBalance,
        totalUnrealizedProfit: account.totalUnrealizedProfit
      };
    } catch (error) {
      logger.error('Error fetching balance', { error: error.message });
      throw error;
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
        if (Math.abs(parseFloat(position.positionAmt)) > 0) {
          const closeParams = {
            symbol: position.symbol,
            side: parseFloat(position.positionAmt) > 0 ? 'SELL' : 'BUY',
            type: 'MARKET',
            quantity: Math.abs(parseFloat(position.positionAmt)).toString(),
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
   * 获取交易规则
   * @param {string} symbol - 交易对
   * @returns {Object} 交易规则
   */
  async getExchangeInfo(symbol) {
    try {
      const info = await this.client.exchangeInfo();
      return info.symbols.find(s => s.symbol === symbol);
    } catch (error) {
      logger.error('Error fetching exchange info', { error: error.message });
      return null;
    }
  }

  /**
   * 调整数量精度
   * @param {number} quantity - 原始数量
   * @param {Object} symbolInfo - 交易对信息
   * @returns {number} 调整后数量
   */
  adjustQuantityPrecision(quantity, symbolInfo) {
    if (!symbolInfo) return quantity;

    const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
    if (lotSizeFilter) {
      const stepSize = parseFloat(lotSizeFilter.stepSize);
      return Math.floor(quantity / stepSize) * stepSize;
    }

    return quantity;
  }

  /**
   * 判断是否为期货交易对
   * @param {string} symbol - 交易对
   * @returns {boolean} 是否为期货
   */
  isFuturesSymbol(symbol) {
    // 简单判断，可以根据需要调整
    return symbol.endsWith('USDT') || symbol.endsWith('BUSD');
  }
}

module.exports = BinanceTrader; 
