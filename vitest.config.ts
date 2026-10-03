import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * 测试配置。
 *
 * 为什么单独一个文件而不是塞进 vite.config.ts：
 * 生产构建配置里有一堆针对「surge 掐连接」的 chunk 拆分策略，
 * 那些与测试无关，混在一起只会让两边都难读。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 重试类用例要等退避，给足超时
    testTimeout: 20000,
  },
})
