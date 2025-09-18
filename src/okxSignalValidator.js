const Joi = require('joi');

class OKXSignalValidator {
  constructor() {
    // OKX特定的信号验证规则
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
      positionSize: Joi.number().positive().optional(),
      positionSizeType: Joi.string().valid('fixed', 'percentage').default('percentage'),
      
      // 止损止盈
      stopLoss: Joi.number().positive().optional(),
      takeProfit: Joi.number().positive().optional(),
      
      // OKX特定参数
      tdMode: Joi.string().valid('cross', 'isolated').default('cross'),
      ordType: Joi.string().valid('market', 'limit', 'conditional').default('market'),
      
      // SMC特定参数
      orderBlock: Joi.alternatives().try(
        Joi.string().valid('bullish', 'bearish'),
        Joi.object({
          type: Joi.string().valid('bullish', 'bearish').optional(),
          price: Joi.number().positive().optional(),
          timeframe: Joi.string().optional()
        })
      ).optional(),
      
      fairValueGap: Joi.alternatives().try(
        Joi.string().valid('bullish', 'bearish'),
        Joi.object({
          upper: Joi.number().positive().optional(),
          lower: Joi.number().positive().optional(),
          timeframe: Joi.string().optional()
        })
      ).optional(),
      
      liquiditySweep: Joi.string().valid('buy_side', 'sell_side').optional(),
      
      liquidityLevel: Joi.object({
        type: Joi.string().valid('buy_side', 'sell_side').optional(),
        price: Joi.number().positive().optional(),
        strength: Joi.string().valid('weak', 'medium', 'strong').optional()
      }).optional(),
      
      // 杠杆（期货）
      leverage: Joi.number().min(1).max(125).optional(),
      
      // 时间戳
      timestamp: Joi.date().default(Date.now),
      
      // 策略信息
      strategy: Joi.string().default('OKX_SMC'),
      timeframe: Joi.string().optional(),
      
      // 风险管理
      riskPercent: Joi.number().min(0).max(100).default(1),
      
      // 可选的消息/备注
      message: Joi.string().optional(),
      
      // TradingView特定字段
      exchange: Joi.string().optional(),
      ticker: Joi.string().optional()
    });
  }

  /**
   * 验证OKX信号
   * @param {Object} signal - 原始信号数据
   * @returns {Object} 验证结果
   */
  validate(signal) {
    try {
      // 预处理信号数据
      const processedSignal = this.preprocessSignal(signal);
      
      // 验证信号格式
      const result = this.signalSchema.validate(processedSignal, {
        allowUnknown: true,
        stripUnknown: false,
        abortEarly: false
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

    // 标准化symbol格式为OKX格式
    if (processed.symbol) {
      processed.symbol = this.convertToOKXSymbol(processed.symbol);
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
    if (processed.sz && !processed.quantity) {
      processed.quantity = processed.sz;
    }

    // 处理时间戳
    if (processed.time && !processed.timestamp) {
      processed.timestamp = processed.time;
    }

    // 处理SMC字段
    if (processed.orderBlock && typeof processed.orderBlock === 'string') {
      processed.orderBlock = { type: processed.orderBlock };
    }
    if (processed.fairValueGap && typeof processed.fairValueGap === 'string') {
      processed.fairValueGap = { type: processed.fairValueGap };
    }

    return processed;
  }

  /**
   * 转换为OKX交易对格式
   * @param {string} symbol - 原始交易对
   * @returns {string} OKX格式交易对
   */
  convertToOKXSymbol(symbol) {
    // 移除特殊字符并转为大写
    let cleanSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
    
    // 如果已经是OKX格式，直接返回
    if (cleanSymbol.includes('-')) {
      return cleanSymbol;
    }
    
    // 转换为OKX格式
    if (cleanSymbol.endsWith('USDT')) {
      const base = cleanSymbol.replace('USDT', '');
      return `${base}-USDT-SWAP`; // 期货合约
    } else if (cleanSymbol.endsWith('BUSD')) {
      const base = cleanSymbol.replace('BUSD', '');
      return `${base}-BUSD-SWAP`;
    } else if (cleanSymbol.endsWith('USDC')) {
      const base = cleanSymbol.replace('USDC', '');
      return `${base}-USDC-SWAP`;
    }
    
    // 默认添加USDT
    return `${cleanSymbol}-USDT-SWAP`;
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
    if (!this.isValidOKXSymbol(signal.symbol)) {
      errors.push('Invalid OKX trading pair format');
    }

    // 验证杠杆
    if (signal.leverage && (signal.leverage < 1 || signal.leverage > 125)) {
      errors.push('Leverage must be between 1 and 125');
    }

    // 验证SMC信号逻辑
    if (signal.strategy === 'OKX_SMC' || signal.strategy === 'SMC') {
      const smcValidation = this.validateSMCSignal(signal);
      if (!smcValidation.valid) {
        errors.push(...smcValidation.errors);
      }
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
   * 验证SMC信号逻辑
   * @param {Object} signal - 信号数据
   * @returns {Object} 验证结果
   */
  validateSMCSignal(signal) {
    const errors = [];

    // 检查是否包含SMC组件
    const hasOrderBlock = signal.orderBlock && signal.orderBlock.type;
    const hasFVG = signal.fairValueGap && signal.fairValueGap.type;
    const hasLiquidity = signal.liquiditySweep || signal.liquidityLevel;

    if (!hasOrderBlock && !hasFVG && !hasLiquidity) {
      errors.push('SMC signal must contain at least one of: orderBlock, fairValueGap, or liquiditySweep');
    }

    // 验证订单区块逻辑
    if (hasOrderBlock) {
      if (signal.action === 'buy' && signal.orderBlock.type !== 'bullish') {
        errors.push('Buy signal with bearish order block is invalid');
      }
      if (signal.action === 'sell' && signal.orderBlock.type !== 'bearish') {
        errors.push('Sell signal with bullish order block is invalid');
      }
    }

    // 验证FVG逻辑
    if (hasFVG) {
      if (signal.action === 'buy' && signal.fairValueGap.type !== 'bullish') {
        errors.push('Buy signal with bearish FVG is invalid');
      }
      if (signal.action === 'sell' && signal.fairValueGap.type !== 'bearish') {
        errors.push('Sell signal with bullish FVG is invalid');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 验证OKX交易对格式
   * @param {string} symbol - 交易对符号
   * @returns {boolean} 是否有效
   */
  isValidOKXSymbol(symbol) {
    // OKX期货合约格式: BTC-USDT-SWAP
    const okxPattern = /^[A-Z0-9]+-(USDT|BUSD|USDC)-(SWAP|PERP)$/;
    return okxPattern.test(symbol);
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
    return ['market', 'limit', 'conditional'];
  }

  /**
   * 获取支持的交易模式
   * @returns {Array} 支持的交易模式
   */
  getSupportedTradingModes() {
    return ['cross', 'isolated'];
  }

  /**
   * 获取支持的SMC组件
   * @returns {Array} 支持的SMC组件
   */
  getSupportedSMCComponents() {
    return ['orderBlock', 'fairValueGap', 'liquiditySweep', 'liquidityLevel'];
  }
}

module.exports = OKXSignalValidator;