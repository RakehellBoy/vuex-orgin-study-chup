export default function (Vue) {
  const version = Number(Vue.version.split('.')[0])

  if (version >= 2) {
    //将Vue构造函数混入beforeCreate, 
    //每个定义组件都会有一个vuexInit的befroeCreate的钩子
    Vue.mixin({ beforeCreate: vuexInit })
  } else 
    // override init and inject vuex init procedure
    // for 1.x backwards compatibility.
    const _init = Vue.prototype._init
    Vue.prototype._init = function (options = {}) {
      options.init = options.init
        ? [vuexInit].concat(options.init)
        : vuexInit
      _init.call(this, options)
    }
  }

  /**
   * Vuex init hook, injected into each instances init hooks list.
   */

  function vuexInit () { 
    // this 指向组件实例 在组件beforeCreate时调用
    const options = this.$options
    // store injection
    if (options.store) { // new Vue时放入了store
      this.$store = typeof options.store === 'function'
        ? options.store()
        : options.store
    } else if (options.parent && options.parent.$store) { // 向父级查找 最后指向的都是new Vue中的 同一个store
      this.$store = options.parent.$store
    }
  }
}
