import { Store, install } from './store'
import { mapState, mapMutations, mapGetters, mapActions, createNamespacedHelpers } from './helpers'

export default {
  Store, // Vuex 主业务类
  install, //Vue组件注入函数   Vue.use(Vuex) 会执行 install
  version: '__VERSION__', 
  mapState, // 导出state辅助函数
  mapMutations, // 导出Mutations辅助函数
  mapGetters, // 导出Getters辅助函数
  mapActions, // 导出Actions辅助函数
  /** 
   * 创建携带了命名空间前缀的辅助函数，让其能像普通辅助函数一样使用
  */
  createNamespacedHelpers
}
