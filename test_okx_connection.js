#!/usr/bin/env node

/**
 * OKX连接测试脚本
 * 用于验证OKX API配置和连接状态
 */

require('dotenv').config();
const OKXTrader = require('./src/okxTrader');

async function testOKXConnection() {
  console.log('🚀 开始测试OKX连接...\n');

  try {
    // 检查环境变量
    console.log('📋 检查环境变量...');
    const requiredEnvVars = ['OKX_API_KEY', 'OKX_SECRET_KEY', 'OKX_PASSPHRASE'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.error('❌ 缺少必需的环境变量:', missingVars.join(', '));
      console.log('请检查 .env 文件中的OKX API配置');
      return;
    }
    
    console.log('✅ 环境变量配置完整\n');

    // 初始化OKX交易器
    console.log('🔧 初始化OKX交易器...');
    const okxTrader = new OKXTrader();
    console.log('✅ OKX交易器初始化成功\n');

    // 测试账户余额
    console.log('💰 测试账户余额获取...');
    try {
      const balance = await okxTrader.getBalance();
      console.log('✅ 账户余额获取成功:');
      console.log(`   - 总余额: ${balance.totalWalletBalance} USDT`);
      console.log(`   - 可用余额: ${balance.availableBalance} USDT`);
      console.log(`   - 未实现盈亏: ${balance.totalUnrealizedProfit} USDT\n`);
    } catch (error) {
      console.error('❌ 账户余额获取失败:', error.message);
      console.log('请检查API密钥权限和网络连接\n');
    }

    // 测试持仓获取
    console.log('📊 测试持仓获取...');
    try {
      const positions = await okxTrader.getPositions();
      console.log('✅ 持仓获取成功:');
      if (positions.length === 0) {
        console.log('   - 当前无持仓\n');
      } else {
        positions.forEach(pos => {
          console.log(`   - ${pos.instId}: ${pos.pos} (盈亏: ${pos.unrealizedPnl})\n`);
        });
      }
    } catch (error) {
      console.error('❌ 持仓获取失败:', error.message);
    }

    // 测试价格获取
    console.log('📈 测试价格获取...');
    try {
      const ticker = await okxTrader.getTicker('BTC-USDT-SWAP');
      console.log('✅ 价格获取成功:');
      console.log(`   - BTC-USDT-SWAP: ${ticker.last} USDT\n`);
    } catch (error) {
      console.error('❌ 价格获取失败:', error.message);
    }

    // 测试工具信息获取
    console.log('🔧 测试工具信息获取...');
    try {
      const instrumentInfo = await okxTrader.getInstrumentInfo('BTC-USDT-SWAP');
      console.log('✅ 工具信息获取成功:');
      console.log(`   - 合约大小: ${instrumentInfo.lotSz}`);
      console.log(`   - 最小数量: ${instrumentInfo.minSz}`);
      console.log(`   - 数量步长: ${instrumentInfo.tickSz}\n`);
    } catch (error) {
      console.error('❌ 工具信息获取失败:', error.message);
    }

    // 测试信号验证
    console.log('🔍 测试信号验证...');
    try {
      const testSignal = {
        symbol: 'BTC-USDT-SWAP',
        action: 'buy',
        price: 50000,
        stopLoss: 49000,
        takeProfit: 52000,
        positionSize: 10,
        positionSizeType: 'percentage',
        leverage: 10,
        riskPercent: 1,
        strategy: 'OKX_SMC',
        orderBlock: { type: 'bullish', price: 49800 },
        fairValueGap: { upper: 50200, lower: 49800 },
        liquiditySweep: 'buy_side'
      };

      const OKXSignalValidator = require('./src/okxSignalValidator');
      const validator = new OKXSignalValidator();
      const validationResult = validator.validate(testSignal);
      
      if (validationResult.valid) {
        console.log('✅ 信号验证成功\n');
      } else {
        console.error('❌ 信号验证失败:', validationResult.error.message);
      }
    } catch (error) {
      console.error('❌ 信号验证测试失败:', error.message);
    }

    console.log('🎉 OKX连接测试完成！');
    console.log('\n📝 下一步:');
    console.log('1. 在TradingView中配置SMC策略');
    console.log('2. 设置Webhook URL指向你的服务器');
    console.log('3. 启动交易服务器: npm start');
    console.log('4. 监控交易信号和日志');

  } catch (error) {
    console.error('❌ 测试过程中发生错误:', error.message);
    console.error('请检查网络连接和API配置');
  }
}

// 运行测试
if (require.main === module) {
  testOKXConnection().catch(console.error);
}

module.exports = testOKXConnection;