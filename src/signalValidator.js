const Joi = require('joi');

class SignalValidator {
  constructor() {
    // TradingView信号验证规则
    this.signalSchema = Joi.object({
      // 基本信号信息
      symbol: Joi.string().required().messages({
        'string.empty': 'Symbol is required',
        'any.required': 'Symbol is required'
      }),
      
      action: Joi.string().valid('buy', 'sell', 'close').required().messages({
        'any.only': 'Action must be buy, sell, or close',
        'any.required': 'Action is required'
      }),
      
      // 价格信息
      price: Joi.number().positive().optional(),
      marketPrice: Joi.boolean().default(true),
      
      // 数量/仓位大小
      quantity: Joi.number().positive().optional(),
      positionSize: Joi.number().positive().optional(), // 可以是固定金额或百分比
      positionSizeType: Joi.string().valid('fixed', 'percentage').default('percentage'),
      
      // 止损止盈
      stopLoss: Joi.number().positive().optional(),
      takeProfit: Joi.number().positive().optional(),
      
      // SMC特定参数
      orderBlock: Joi.object({
        type: Joi.string().valid('bullish', 'bearish').optional(),
        price: Joi.number().positive().optional(),
        timeframe: Joi.string().optional()
      }).optional(),
      
      fairValueGap: Joi.object({
        upper: Joi.number().positive().optional(),
        lower: Joi.number().positive().optional(),
        timeframe: Joi.string().optional()
      }).optional(),
      
      liquidityLevel: Joi.object({
        type: Joi.string().valid('buy_side', 'sell_side').optional(),
        price: Joi.number().positive().optional(),
        strength: Joi.string().valid('weak', 'medium', 'strong').optional()
      }).optional(),
      
      // 订单类型
      orderType: Joi.string().valid('market', 'limit', 'stop').default('market'),
      
      // 杠杆（期货）
      leverage: Joi.number().min(1).max(125).optional(),
      
      // 时间戳
      timestamp: Joi.date().default(Date.now),
      
      // 策略信息
      strategy: Joi.string().default('SMC'),
      timeframe: Joi.string().optional(),
      
      // 风险管理
      riskPercent: Joi.number().min(0).max(100).default(1), // 风险百分比
      
      // 可选的消息/备注
      message: Joi.string().optional(),
      
      // TradingView特定字段
      exchange: Joi.string().optional(),
      ticker: Joi.string().optional()
    });
  }

  /**
   * 验证TradingView信号
   * @param {Object} signal - 原始信号数据
   * @returns {Object} 验证结果
   */
  validate(signal) {
    try {
      // 预处理信号数据
      const processedSignal = this.preprocessSignal(signal);
      
      // 验证信号格式
      const result = this.signalSchema.validate(processedSignal, {
        allowUnknown: true, // 允许额外字段
        stripUnknown: false, // 保留未知字段用于调试
        abortEarly: false // 返回所有验证错误
      });

      if (result.error) {
        return {
          error: result.error,
          valid: false
        };
      }

      // 进行业务逻辑验证
      const businessValidation = this.validateBusinessLogic(result.value);
      if (!businessValidation.valid) {
        return businessValidation;
      }

      return {
        value: result.value,
        valid: true
      };

    } catch (error) {
      return {
        error: new Error(`Validation error: ${error.message}`),
        valid: false
      };
    }
  }

  /**
   * 预处理信号数据
   * @param {Object} signal - 原始信号
   * @returns {Object} 处理后的信号
   */
  preprocessSignal(signal) {
    const processed = { ...signal };

    // 标准化symbol格式
    if (processed.symbol) {
      processed.symbol = processed.symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
      
      // 如果是币安格式，确保是USDT交易对
      if (!processed.symbol.endsWith('USDT') && !processed.symbol.endsWith('BUSD')) {
        processed.symbol += 'USDT';
      }
    }

    // 标准化action
    if (processed.action) {
      processed.action = processed.action.toLowerCase();
    }

    // 处理不同的price字段名
    if (processed.entry_price && !processed.price) {
      processed.price = processed.entry_price;
    }

    // 处理不同的止损止盈字段名
    if (processed.stop_loss && !processed.stopLoss) {
      processed.stopLoss = processed.stop_loss;
    }
    if (processed.take_profit && !processed.takeProfit) {
      processed.takeProfit = processed.take_profit;
    }

    // 处理数量字段
    if (processed.qty && !processed.quantity) {
      processed.quantity = processed.qty;
    }

    // 处理时间戳
    if (processed.time && !processed.timestamp) {
      processed.timestamp = processed.time;
    }

    return processed;
  }

  /**
   * 业务逻辑验证
   * @param {Object} signal - 已验证格式的信号
   * @returns {Object} 业务验证结果
   */
  validateBusinessLogic(signal) {
    const errors = [];

    // 验证止损止盈逻辑
    if (signal.action === 'buy' || signal.action === 'sell') {
      if (signal.stopLoss && signal.price) {
        if (signal.action === 'buy' && signal.stopLoss >= signal.price) {
          errors.push('Buy order stop loss must be below entry price');
        }
        if (signal.action === 'sell' && signal.stopLoss <= signal.price) {
          errors.push('Sell order stop loss must be above entry price');
        }
      }

      if (signal.takeProfit && signal.price) {
        if (signal.action === 'buy' && signal.takeProfit <= signal.price) {
          errors.push('Buy order take profit must be above entry price');
        }
        if (signal.action === 'sell' && signal.takeProfit >= signal.price) {
          errors.push('Sell order take profit must be below entry price');
        }
      }
    }

    // 验证风险百分比
    if (signal.riskPercent > 10) {
      errors.push('Risk percentage too high (>10%)');
    }

    // 验证仓位大小
    if (signal.positionSizeType === 'percentage' && signal.positionSize > 100) {
      errors.push('Position size percentage cannot exceed 100%');
    }

    // 验证symbol格式
    if (!this.isValidTradingPair(signal.symbol)) {
      errors.push('Invalid trading pair format');
    }

    if (errors.length > 0) {
      return {
        error: new Error(errors.join('; ')),
        valid: false
      };
    }

    return { valid: true };
  }

  /**
   * 验证交易对格式
   * @param {string} symbol - 交易对符号
   * @returns {boolean} 是否有效
   */
  isValidTradingPair(symbol) {
    // 币安支持的主要稳定币交易对
    const validSuffixes = ['USDT', 'BUSD', 'USDC'];
    return validSuffixes.some(suffix => symbol.endsWith(suffix));
  }

  /**
   * 获取支持的操作类型
   * @returns {Array} 支持的操作
   */
  getSupportedActions() {
    return ['buy', 'sell', 'close'];
  }

  /**
   * 获取支持的订单类型
   * @returns {Array} 支持的订单类型
   */
  getSupportedOrderTypes() {
    return ['market', 'limit', 'stop'];
  }
}

module.exports = SignalValidator; 
