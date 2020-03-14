export default function (Vue) {
  const version = Number(Vue.version.split('.')[0]) // 获取当前Vue版本

  if (version >= 2) {
    // 每个vue实例组件都有一个befroeCreate的钩子用来初始化Vuex
    Vue.mixin({ beforeCreate: vuexInit })
  } else {
    //(可以不用关注了) Vue1.x版本还没有生命周期钩子, 通过重写_init函数， 注入额外代码实现
    const _init = Vue.prototype._init
    Vue.prototype._init = function (options = {}) {
      options.init = options.init? [vuexInit].concat(options.init) : vuexInit
      _init.call(this, options)
    }
  }

  /**
   * Vuex init hook, injected into each instances init hooks list.
   */

  function vuexInit () {  // Vue组件实例化时 由beforeCreate钩子调用
    const options = this.$options // this 指向Vue组件实例
    if (options.store) { // new Vue时放入了store
      this.$store = typeof options.store === 'function'
        ? options.store() // 与Vue的data属性同理，为了复用配置,生成不同地址的对象，避免相关污染
        : options.store // 在new vue是传入的Vuex实例
    } else if (options.parent && options.parent.$store) { // 向父级查找 最后指向的都是new Vue中的 同一个store
      this.$store = options.parent.$store
    }
  }
}
