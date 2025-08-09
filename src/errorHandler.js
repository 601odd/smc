const winston = require('winston');

// 配置错误日志
const errorLogger = winston.createLogger({
  level: 'error',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'error-handler' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/critical.log', level: 'error' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

class ErrorHandler {
  constructor() {
    this.errorTypes = {
      VALIDATION_ERROR: 'VALIDATION_ERROR',
      BINANCE_API_ERROR: 'BINANCE_API_ERROR',
      NETWORK_ERROR: 'NETWORK_ERROR',
      INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
      INVALID_SYMBOL: 'INVALID_SYMBOL',
      ORDER_FAILED: 'ORDER_FAILED',
      RATE_LIMIT_ERROR: 'RATE_LIMIT_ERROR',
      PERMISSION_ERROR: 'PERMISSION_ERROR',
      UNKNOWN_ERROR: 'UNKNOWN_ERROR'
    };

    this.errorStats = new Map(); // 错误统计
    this.alertThresholds = {
      errorRate: 10, // 10个错误/分钟
      criticalErrors: 3, // 3个关键错误/小时
      consecutiveFailures: 5 // 连续失败次数
    };

    this.consecutiveFailures = 0;
    this.lastErrorTime = null;
  }

  /**
   * 处理错误
   * @param {Error} error - 错误对象
   * @param {string} context - 错误上下文
   * @param {Object} metadata - 额外的元数据
   * @returns {Object} 处理结果
   */
  handleError(error, context = 'unknown', metadata = {}) {
    const errorInfo = this.analyzeError(error, context, metadata);
    
    // 记录错误
    this.logError(errorInfo);
    
    // 更新统计
    this.updateErrorStats(errorInfo);
    
    // 检查是否需要告警
    this.checkAlertConditions(errorInfo);
    
    // 返回标准化的错误响应
    return this.formatErrorResponse(errorInfo);
  }

  /**
   * 分析错误类型和严重程度
   * @param {Error} error - 错误对象
   * @param {string} context - 错误上下文
   * @param {Object} metadata - 元数据
   * @returns {Object} 错误分析结果
   */
  analyzeError(error, context, metadata) {
    const errorInfo = {
      timestamp: new Date(),
      context,
      message: error.message,
      stack: error.stack,
      metadata,
      type: this.errorTypes.UNKNOWN_ERROR,
      severity: 'medium',
      retryable: false,
      userMessage: '系统发生错误，请稍后重试'
    };

    // 分析Binance API错误
    if (this.isBinanceError(error)) {
      errorInfo.type = this.errorTypes.BINANCE_API_ERROR;
      errorInfo.binanceCode = error.code;
      
      switch (error.code) {
        case -1021: // Timestamp outside of recv window
        case -1022: // Signature not valid
          errorInfo.severity = 'high';
          errorInfo.userMessage = 'API认证错误，请检查API密钥配置';
          break;
          
        case -2010: // Account has insufficient balance
          errorInfo.type = this.errorTypes.INSUFFICIENT_BALANCE;
          errorInfo.severity = 'medium';
          errorInfo.userMessage = '账户余额不足';
          break;
          
        case -1121: // Invalid symbol
          errorInfo.type = this.errorTypes.INVALID_SYMBOL;
          errorInfo.severity = 'medium';
          errorInfo.userMessage = '无效的交易对';
          break;
          
        case -1013: // Invalid quantity
        case -1111: // Precision is over the maximum
          errorInfo.type = this.errorTypes.VALIDATION_ERROR;
          errorInfo.severity = 'medium';
          errorInfo.retryable = true;
          errorInfo.userMessage = '订单参数错误';
          break;
          
        case -1003: // Too many requests
          errorInfo.type = this.errorTypes.RATE_LIMIT_ERROR;
          errorInfo.severity = 'medium';
          errorInfo.retryable = true;
          errorInfo.userMessage = '请求过于频繁，请稍后重试';
          break;
          
        default:
          errorInfo.severity = 'medium';
          errorInfo.retryable = true;
      }
    }
    
    // 分析网络错误
    else if (this.isNetworkError(error)) {
      errorInfo.type = this.errorTypes.NETWORK_ERROR;
      errorInfo.severity = 'medium';
      errorInfo.retryable = true;
      errorInfo.userMessage = '网络连接错误，请稍后重试';
    }
    
    // 分析验证错误
    else if (this.isValidationError(error)) {
      errorInfo.type = this.errorTypes.VALIDATION_ERROR;
      errorInfo.severity = 'low';
      errorInfo.userMessage = '输入参数无效';
    }
    
    // 分析权限错误
    else if (this.isPermissionError(error)) {
      errorInfo.type = this.errorTypes.PERMISSION_ERROR;
      errorInfo.severity = 'high';
      errorInfo.userMessage = 'API权限不足';
    }

    return errorInfo;
  }

  /**
   * 记录错误日志
   * @param {Object} errorInfo - 错误信息
   */
  logError(errorInfo) {
    const logData = {
      type: errorInfo.type,
      context: errorInfo.context,
      message: errorInfo.message,
      severity: errorInfo.severity,
      metadata: errorInfo.metadata,
      timestamp: errorInfo.timestamp
    };

    if (errorInfo.severity === 'high') {
      errorLogger.error('High severity error', logData);
    } else if (errorInfo.severity === 'medium') {
      errorLogger.warn('Medium severity error', logData);
    } else {
      errorLogger.info('Low severity error', logData);
    }

    // 关键错误需要包含堆栈信息
    if (errorInfo.severity === 'high') {
      errorLogger.error('Error stack trace', { 
        stack: errorInfo.stack,
        context: errorInfo.context 
      });
    }
  }

  /**
   * 更新错误统计
   * @param {Object} errorInfo - 错误信息
   */
  updateErrorStats(errorInfo) {
    const now = new Date();
    const minute = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 
                           now.getHours(), now.getMinutes());

    // 按分钟统计错误
    const minuteKey = minute.toISOString();
    if (!this.errorStats.has(minuteKey)) {
      this.errorStats.set(minuteKey, {
        total: 0,
        byType: new Map(),
        bySeverity: new Map()
      });
    }

    const stats = this.errorStats.get(minuteKey);
    stats.total++;
    
    // 按类型统计
    const typeCount = stats.byType.get(errorInfo.type) || 0;
    stats.byType.set(errorInfo.type, typeCount + 1);
    
    // 按严重程度统计
    const severityCount = stats.bySeverity.get(errorInfo.severity) || 0;
    stats.bySeverity.set(errorInfo.severity, severityCount + 1);

    // 更新连续失败计数
    if (errorInfo.severity === 'high') {
      this.consecutiveFailures++;
      this.lastErrorTime = now;
    } else {
      this.consecutiveFailures = 0;
    }

    // 清理旧的统计数据 (保留最近24小时)
    this.cleanupOldStats();
  }

  /**
   * 检查告警条件
   * @param {Object} errorInfo - 错误信息
   */
  checkAlertConditions(errorInfo) {
    const now = new Date();
    
    // 检查连续失败
    if (this.consecutiveFailures >= this.alertThresholds.consecutiveFailures) {
      this.sendAlert('CONSECUTIVE_FAILURES', {
        count: this.consecutiveFailures,
        lastError: errorInfo
      });
    }

    // 检查错误率
    const currentMinute = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 
                                  now.getHours(), now.getMinutes()).toISOString();
    const stats = this.errorStats.get(currentMinute);
    
    if (stats && stats.total >= this.alertThresholds.errorRate) {
      this.sendAlert('HIGH_ERROR_RATE', {
        rate: stats.total,
        minute: currentMinute,
        breakdown: Object.fromEntries(stats.byType)
      });
    }

    // 检查关键错误
    if (errorInfo.severity === 'high') {
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const criticalCount = this.getCriticalErrorCount(hourAgo);
      
      if (criticalCount >= this.alertThresholds.criticalErrors) {
        this.sendAlert('CRITICAL_ERRORS', {
          count: criticalCount,
          timeframe: '1 hour'
        });
      }
    }
  }

  /**
   * 发送告警
   * @param {string} type - 告警类型
   * @param {Object} data - 告警数据
   */
  sendAlert(type, data) {
    errorLogger.error(`ALERT: ${type}`, data);
    
    // 这里可以集成告警系统，比如：
    // - 发送邮件
    // - 发送钉钉/微信通知
    // - 发送短信
    // - 调用Webhook
    
    console.error(`🚨 ALERT: ${type}`, data);
  }

  /**
   * 格式化错误响应
   * @param {Object} errorInfo - 错误信息
   * @returns {Object} 标准化错误响应
   */
  formatErrorResponse(errorInfo) {
    return {
      success: false,
      error: {
        type: errorInfo.type,
        message: errorInfo.userMessage,
        code: errorInfo.binanceCode || null,
        retryable: errorInfo.retryable,
        timestamp: errorInfo.timestamp
      }
    };
  }

  /**
   * 获取错误统计
   * @param {Date} startTime - 开始时间
   * @param {Date} endTime - 结束时间
   * @returns {Object} 统计数据
   */
  getErrorStats(startTime, endTime) {
    const stats = {
      totalErrors: 0,
      byType: new Map(),
      bySeverity: new Map(),
      errorRate: 0
    };

    for (const [minute, data] of this.errorStats.entries()) {
      const minuteTime = new Date(minute);
      if (minuteTime >= startTime && minuteTime <= endTime) {
        stats.totalErrors += data.total;
        
        for (const [type, count] of data.byType.entries()) {
          const currentCount = stats.byType.get(type) || 0;
          stats.byType.set(type, currentCount + count);
        }
        
        for (const [severity, count] of data.bySeverity.entries()) {
          const currentCount = stats.bySeverity.get(severity) || 0;
          stats.bySeverity.set(severity, currentCount + count);
        }
      }
    }

    // 计算错误率（每分钟）
    const minutes = Math.max(1, (endTime - startTime) / (60 * 1000));
    stats.errorRate = stats.totalErrors / minutes;

    return {
      totalErrors: stats.totalErrors,
      byType: Object.fromEntries(stats.byType),
      bySeverity: Object.fromEntries(stats.bySeverity),
      errorRate: Math.round(stats.errorRate * 100) / 100
    };
  }

  /**
   * 错误类型判断方法
   */
  isBinanceError(error) {
    return error.code && typeof error.code === 'number';
  }

  isNetworkError(error) {
    return error.code === 'ECONNRESET' || 
           error.code === 'ENOTFOUND' || 
           error.code === 'ETIMEDOUT' ||
           error.message.includes('network') ||
           error.message.includes('timeout');
  }

  isValidationError(error) {
    return error.name === 'ValidationError' ||
           error.message.includes('validation') ||
           error.message.includes('invalid');
  }

  isPermissionError(error) {
    return error.message.includes('permission') ||
           error.message.includes('unauthorized') ||
           error.message.includes('forbidden');
  }

  getCriticalErrorCount(since) {
    let count = 0;
    for (const [minute, stats] of this.errorStats.entries()) {
      const minuteTime = new Date(minute);
      if (minuteTime >= since) {
        count += stats.bySeverity.get('high') || 0;
      }
    }
    return count;
  }

  cleanupOldStats() {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    for (const minute of this.errorStats.keys()) {
      if (new Date(minute) < oneDayAgo) {
        this.errorStats.delete(minute);
      }
    }
  }
}

module.exports = ErrorHandler; 
