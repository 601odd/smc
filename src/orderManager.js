const winston = require('winston');

// 配置日志
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'order-manager' },
  transports: [
    new winston.transports.File({ filename: 'logs/orders.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

class OrderManager {
  constructor(binanceClient) {
    this.binanceClient = binanceClient;
    this.activeOrders = new Map(); // orderId -> orderInfo
    this.orderHistory = new Map(); // orderId -> orderInfo
    this.positionTracker = new Map(); // symbol -> positionInfo
    
    // 定期同步订单状态
    this.syncInterval = setInterval(() => {
      this.syncOrderStatus();
    }, 30000); // 每30秒同步一次
  }

  /**
   * 添加新订单到跟踪
   * @param {Object} order - 订单信息
   * @param {Object} signal - 原始信号
   */
  addOrder(order, signal) {
    const orderInfo = {
      orderId: order.orderId,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      quantity: order.origQty || order.quantity,
      price: order.price,
      status: order.status,
      signal: signal,
      createdAt: new Date(),
      updatedAt: new Date(),
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      fills: order.fills || []
    };

    this.activeOrders.set(order.orderId, orderInfo);
    logger.info('Order added to tracking', { orderId: order.orderId, symbol: order.symbol });

    // 更新持仓跟踪
    this.updatePositionTracker(orderInfo);
  }

  /**
   * 更新订单状态
   * @param {string} orderId - 订单ID
   * @param {Object} updateData - 更新数据
   */
  updateOrder(orderId, updateData) {
    const orderInfo = this.activeOrders.get(orderId);
    if (orderInfo) {
      Object.assign(orderInfo, updateData, { updatedAt: new Date() });
      
      // 如果订单已完成，移动到历史记录
      if (['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED'].includes(updateData.status)) {
        this.activeOrders.delete(orderId);
        this.orderHistory.set(orderId, orderInfo);
        logger.info('Order completed and moved to history', { 
          orderId, 
          status: updateData.status 
        });
      }
    }
  }

  /**
   * 获取活跃订单
   * @param {string} symbol - 可选的交易对筛选
   * @returns {Array} 活跃订单列表
   */
  getActiveOrders(symbol = null) {
    let orders = Array.from(this.activeOrders.values());
    
    if (symbol) {
      orders = orders.filter(order => order.symbol === symbol);
    }
    
    return orders;
  }

  /**
   * 获取订单历史
   * @param {string} symbol - 可选的交易对筛选
   * @param {number} limit - 限制返回数量
   * @returns {Array} 历史订单列表
   */
  getOrderHistory(symbol = null, limit = 100) {
    let orders = Array.from(this.orderHistory.values());
    
    if (symbol) {
      orders = orders.filter(order => order.symbol === symbol);
    }
    
    // 按创建时间倒序排列
    orders.sort((a, b) => b.createdAt - a.createdAt);
    
    return orders.slice(0, limit);
  }

  /**
   * 更新持仓跟踪
   * @param {Object} orderInfo - 订单信息
   */
  updatePositionTracker(orderInfo) {
    if (orderInfo.status === 'FILLED') {
      const position = this.positionTracker.get(orderInfo.symbol) || {
        symbol: orderInfo.symbol,
        quantity: 0,
        averagePrice: 0,
        unrealizedPnl: 0,
        orders: []
      };

      // 计算新的持仓
      const orderQuantity = parseFloat(orderInfo.quantity);
      const orderPrice = parseFloat(orderInfo.price);
      const isBuy = orderInfo.side === 'BUY';

      if (isBuy) {
        // 买入订单
        const totalCost = position.quantity * position.averagePrice + orderQuantity * orderPrice;
        position.quantity += orderQuantity;
        position.averagePrice = totalCost / position.quantity;
      } else {
        // 卖出订单
        position.quantity -= orderQuantity;
        if (position.quantity <= 0) {
          position.quantity = 0;
          position.averagePrice = 0;
        }
      }

      position.orders.push(orderInfo.orderId);
      position.lastUpdated = new Date();

      this.positionTracker.set(orderInfo.symbol, position);
    }
  }

  /**
   * 获取持仓信息
   * @param {string} symbol - 可选的交易对筛选
   * @returns {Array} 持仓信息
   */
  getPositions(symbol = null) {
    let positions = Array.from(this.positionTracker.values());
    
    if (symbol) {
      positions = positions.filter(pos => pos.symbol === symbol);
    }
    
    // 只返回有持仓的交易对
    return positions.filter(pos => pos.quantity > 0);
  }

  /**
   * 同步订单状态
   */
  async syncOrderStatus() {
    try {
      const activeOrderIds = Array.from(this.activeOrders.keys());
      
      for (const orderId of activeOrderIds) {
        const orderInfo = this.activeOrders.get(orderId);
        if (orderInfo) {
          try {
            // 查询订单状态
            const orderStatus = await this.binanceClient.getOrder({
              symbol: orderInfo.symbol,
              orderId: orderId
            });

            // 更新订单状态
            if (orderStatus.status !== orderInfo.status) {
              this.updateOrder(orderId, {
                status: orderStatus.status,
                executedQty: orderStatus.executedQty,
                cummulativeQuoteQty: orderStatus.cummulativeQuoteQty
              });
            }
          } catch (error) {
            logger.warn('Failed to sync order status', { 
              orderId, 
              error: error.message 
            });
          }
        }
      }
    } catch (error) {
      logger.error('Error during order status sync', { error: error.message });
    }
  }

  /**
   * 取消订单
   * @param {string} orderId - 订单ID
   * @returns {Object} 取消结果
   */
  async cancelOrder(orderId) {
    try {
      const orderInfo = this.activeOrders.get(orderId);
      if (!orderInfo) {
        throw new Error(`Order ${orderId} not found in active orders`);
      }

      const result = await this.binanceClient.cancelOrder({
        symbol: orderInfo.symbol,
        orderId: orderId
      });

      this.updateOrder(orderId, { status: 'CANCELED' });
      logger.info('Order canceled', { orderId });

      return result;
    } catch (error) {
      logger.error('Error canceling order', { orderId, error: error.message });
      throw error;
    }
  }

  /**
   * 取消交易对的所有活跃订单
   * @param {string} symbol - 交易对
   * @returns {Array} 取消结果
   */
  async cancelAllOrders(symbol) {
    try {
      const symbolOrders = this.getActiveOrders(symbol);
      const results = [];

      for (const order of symbolOrders) {
        try {
          const result = await this.cancelOrder(order.orderId);
          results.push(result);
        } catch (error) {
          logger.warn('Failed to cancel order', { 
            orderId: order.orderId, 
            error: error.message 
          });
        }
      }

      logger.info('All orders canceled for symbol', { symbol, count: results.length });
      return results;
    } catch (error) {
      logger.error('Error canceling all orders', { symbol, error: error.message });
      throw error;
    }
  }

  /**
   * 获取交易统计
   * @param {string} symbol - 可选的交易对筛选
   * @param {Date} startDate - 开始日期
   * @param {Date} endDate - 结束日期
   * @returns {Object} 统计信息
   */
  getTradeStatistics(symbol = null, startDate = null, endDate = null) {
    let orders = Array.from(this.orderHistory.values());

    // 筛选条件
    if (symbol) {
      orders = orders.filter(order => order.symbol === symbol);
    }
    
    if (startDate) {
      orders = orders.filter(order => order.createdAt >= startDate);
    }
    
    if (endDate) {
      orders = orders.filter(order => order.createdAt <= endDate);
    }

    // 只统计已成交的订单
    const filledOrders = orders.filter(order => order.status === 'FILLED');

    const stats = {
      totalOrders: filledOrders.length,
      totalVolume: 0,
      buyOrders: 0,
      sellOrders: 0,
      averageOrderSize: 0,
      symbols: new Set()
    };

    filledOrders.forEach(order => {
      const volume = parseFloat(order.quantity) * parseFloat(order.price);
      stats.totalVolume += volume;
      stats.symbols.add(order.symbol);

      if (order.side === 'BUY') {
        stats.buyOrders++;
      } else {
        stats.sellOrders++;
      }
    });

    if (stats.totalOrders > 0) {
      stats.averageOrderSize = stats.totalVolume / stats.totalOrders;
    }

    stats.symbols = Array.from(stats.symbols);

    return stats;
  }

  /**
   * 清理资源
   */
  destroy() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
  }
}

module.exports = OrderManager; 
