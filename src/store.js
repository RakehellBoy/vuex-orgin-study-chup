import applyMixin from './mixin'
import devtoolPlugin from './plugins/devtool'
import ModuleCollection from './module/module-collection'
import { forEachValue, isObject, isPromise, assert, partial } from './util'

let Vue // bind on install

export class Store {
  constructor (options = {}) {
    // 不通过npm安装vue 通过cdn链接形式
    if (!Vue && typeof window !== 'undefined' && window.Vue) {
      install(window.Vue)
    }

    if (process.env.NODE_ENV !== 'production') {
      // assert第一个参数为false 就会报错
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
      assert(this instanceof Store, `store must be called with the new operator.`)
    }

    // ES6的写法，定义变量从options中拿值(解构赋值)， options中解构赋值失败添加默认值
    const { plugins = [], strict = false } = options

    // store internal state
    this._committing = false // 提交状态标识，在严格模式时，防止非commit操作下，state被修改
    this._actions = Object.create(null) // action 函数的数组的对象，保存所有action回调函数，
    this._actionSubscribers = [] // 订阅 action 操作的函数数组。里面的每个函数，将在 action函数被调用前被调用，该功能常用于插件，与主功能无关
    this._mutations = Object.create(null) // 解析并生成模块树，通过树结构，保存配置文件内容
    this._wrappedGetters = Object.create(null) // 保存 getter 函数的函数数组对象容器。
    this._modules = new ModuleCollection(options) // 通过_children生成子父级module树
    this._modulesNamespaceMap = Object.create(null) // 保存命名空间的模块对象，以便在辅助函数createNamespacedHelpers中快速定位到带命名空间的模块
    this._subscribers = [] // 订阅 mutation 操作的函数数组。里面的每个函数，将在 commit 执行完成后被调用，该功能常用于插件，与主功能无关
    this._watcherVM = new Vue() // 定义一个Vue对象，Vue类在调用Vuex安装函数，install时，被传递进来
    this._makeLocalGettersCache = Object.create(null)

    // bind commit and dispatch to self
    const store = this
    const { dispatch, commit } = this
    /* 复写的作用，是将两个函数的 this 绑定到 Vuex 实例本身。防止 this 的指向被修改。(外围无法使用call apply bind修改this指向)
       因为这两个函数，可以通过 mapMutations 和 mapActions 辅助函数转化为 Vue 中的普通函数，这时 this 将指向 Vue 组件，而不是 Vuex 实例。所以在这里先将this锁定好
    */
    this.dispatch = function boundDispatch (type, payload) {
      return dispatch.call(store, type, payload)
    }
    this.commit = function boundCommit (type, payload, options) {
      return commit.call(store, type, payload, options)
    }

    this.strict = strict //配置严谨模式参数
    const state = this._modules.root.state // 最外围 根 state

    // init root module.
    // 初始化 actions/mutations/getters等  比较重要
    installModule(this, state, [], this._modules.root)

    // initialize the store vm, which is responsible for the reactivity
    // (also registers _wrappedGetters as computed properties)
    //state值变成响应式，通过vue的defineProperty依赖收集和派发
    resetStoreVM(this, state)

    // apply plugins
    plugins.forEach(plugin => plugin(this))

    const useDevtools = options.devtools !== undefined ? options.devtools : Vue.config.devtools
    if (useDevtools) {
      devtoolPlugin(this)
    }
  }

  get state () { // this.$store.state
    return this._vm._data.$$state
  }

  set state (v) { // this.$store.state = xxx 报错
    if (process.env.NODE_ENV !== 'production') {
      assert(false, `use store.replaceState() to explicit replace store state.`)
    }
  }

  commit (_type, _payload, _options) {
    const { type, payload, options } = unifyObjectStyle(_type, _payload, _options)  //unifyObjectStyle格式规范化，规范化如果type非字符串 直接报错停止执行
    const mutation = { type, payload }
    const entry = this._mutations[type]
    if (!entry) { // 没有找到对应的mutation
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[vuex] unknown mutation type: ${type}`)
      }
      return
    }
    this._withCommit(() => {
      entry.forEach(function commitIterator (handler) {
        handler(payload)
      })
    })

    this._subscribers
      .slice() // shallow copy to prevent iterator invalidation if subscriber synchronously calls unsubscribe
      .forEach(sub => sub(mutation, this.state))

    if (
      process.env.NODE_ENV !== 'production' &&
      options && options.silent
    ) {
      console.warn(
        `[vuex] mutation type: ${type}. Silent option has been removed. ` +
        'Use the filter functionality in the vue-devtools'
      )
    }
  }

  dispatch (_type, _payload) {

    const { type, payload } = unifyObjectStyle(_type, _payload)
    const action = { type, payload }
    const entry = this._actions[type]
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[vuex] unknown action type: ${type}`)
      }
      return
    }

    /** 先把_actionSubscribers数组中的before的函数都执行完之后，在分发action对应的类型。
     * 执行完毕之后在执行_actionSubscribers数组after配置的方法。
     * 值得注意的是，分发action的时候采用了Promise。所以比较适合在action里面执行异步函数。
     * */

    try {
      this._actionSubscribers
        .slice() //slice() 对数组浅复制, 以防止订阅服务器同步调用unsubscribe时 迭代器失效
        .filter(sub => sub.before)
        .forEach(sub => sub.before(action, this.state))
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[vuex] error in before action subscribers: `)
        console.error(e)
      }
    }

    const result = entry.length > 1
      ? Promise.all(entry.map(handler => handler(payload)))
      : entry[0](payload)

    return result.then(res => {
      try {
        this._actionSubscribers
          .filter(sub => sub.after)
          .forEach(sub => sub.after(action, this.state))
      } catch (e) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[vuex] error in after action subscribers: `)
          console.error(e)
        }
      }
      return res
    })
  }

  subscribe (fn) {
    return genericSubscribe(fn, this._subscribers)
  }
  // 订阅 store 的 action。handler 会在每个 action 分发的时候调用并接收 action 描述和当前的 store 的 state 两个参数， 要停止订阅，调用此方法返回的函数即可停止订阅。
  // 从 3.1.0 起，subscribeAction 也可以指定订阅处理函数的被调用时机应该在一个 action 分发之前还是之后 (默认行为是之前)
  subscribeAction (fn) { // 该方法就是将我们配置的对象/函数放到_actionSubscribers数组中，并返回一个方法用来去除添加的对象
    const subs = typeof fn === 'function' ? { before: fn } : fn
    return genericSubscribe(subs, this._actionSubscribers)
  }

  watch (getter, cb, options) {
    if (process.env.NODE_ENV !== 'production') {
      assert(typeof getter === 'function', `store.watch only accepts a function.`)
    }
    return this._watcherVM.$watch(() => getter(this.state, this.getters), cb, options)
  }

  replaceState (state) {
    this._withCommit(() => {
      this._vm._data.$$state = state
    })
  }

  registerModule (path, rawModule, options = {}) {
    if (typeof path === 'string') path = [path]

    if (process.env.NODE_ENV !== 'production') {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
      assert(path.length > 0, 'cannot register the root module by using registerModule.')
    }

    this._modules.register(path, rawModule)
    installModule(this, this.state, path, this._modules.get(path), options.preserveState)
    // reset store to update getters...
    resetStoreVM(this, this.state)
  }

  unregisterModule (path) {
    if (typeof path === 'string') path = [path]

    if (process.env.NODE_ENV !== 'production') {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    this._modules.unregister(path)
    this._withCommit(() => {
      const parentState = getNestedState(this.state, path.slice(0, -1))
      Vue.delete(parentState, path[path.length - 1])
    })
    resetStore(this)
  }

   //热更新modules
  hotUpdate (newOptions) {
    this._modules.update(newOptions) 
    resetStore(this, true)
  }

  /**
   *  该函数的操作只是将设置_committing标识符为ture，然后执行某函数，函数执行完在将_committing设置为原来的值
      即允许在函数函数执行期间，修改state的值, 用于在严格模式时，防止非commit方式修改state
   */
  _withCommit (fn) {
    const committing = this._committing
    this._committing = true
    fn()
    this._committing = committing
  }
}

function genericSubscribe (fn, subs) {
  if (subs.indexOf(fn) < 0) {
    subs.push(fn)
  }
  return () => { //返回一个函数 用来取消订阅的
    const i = subs.indexOf(fn)
    if (i > -1) {
      subs.splice(i, 1)
    }
  }
}

function resetStore (store, hot) {
  store._actions = Object.create(null)
  store._mutations = Object.create(null)
  store._wrappedGetters = Object.create(null)
  store._modulesNamespaceMap = Object.create(null)
  const state = store.state
  // init all modules
  installModule(store, state, [], store._modules.root, true)
  // reset vm
  resetStoreVM(store, state, hot)
}

function resetStoreVM (store, state, hot) {
  const oldVm = store._vm

  // bind store public getters
  store.getters = {}
  // reset local getters cache
  store._makeLocalGettersCache = Object.create(null)
  const wrappedGetters = store._wrappedGetters
  const computed = {}
  forEachValue(wrappedGetters, (fn, key) => {
    // use computed to leverage its lazy-caching mechanism
    // direct inline function use will lead to closure preserving oldVm.
    // using partial to return function with only arguments preserved in closure environment.
    computed[key] = partial(fn, store)
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true // for local getters
    })
  })

  // use a Vue instance to store the state tree
  // suppress warnings just in case the user has added
  // some funky global mixins
  const silent = Vue.config.silent
  Vue.config.silent = true // 取消Vue所有的日志和警告
  store._vm = new Vue({
    data: {
      $$state: state
    },
    computed
  })
  Vue.config.silent = silent

  // enable strict mode for new vm
  if (store.strict) {
    enableStrictMode(store)  // 严格模式 通过vm.$watch监听store.state深层变化，配合store._commiting做提示
  }

  if (oldVm) {
    if (hot) {
      // dispatch changes in all subscribed watchers
      // to force getter re-evaluation for hot reloading.
      store._withCommit(() => {
        oldVm._data.$$state = null
      })
    }
    Vue.nextTick(() => oldVm.$destroy())
  }
}
/** stroe: store对象(不变)
 * rootState: state对象，根据递归初始化传入不一样
 * path: 当前模块所处层级数组
 * module: 模块对象
 * hot: 很少用到*/
function installModule (store, rootState, path, module, hot) {
  const isRoot = !path.length // 判断当前模块是否根模块
  // path=['p1', 'p2', 'p3'] => "p1/p3/" (p2模块namespaced : false 或没设置将不添加)
  const namespace = store._modules.getNamespace(path)

  if (module.namespaced) { // modules配置 namespaced = true, 如都没有配置stroe._modulesNamespaceMap一直为[]
    if (store._modulesNamespaceMap[namespace] && process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
    }
    store._modulesNamespaceMap[namespace] = module
  }

  // 根据modules 生成state形成树状结构
  if (!isRoot && !hot) { //非根root
    const parentState = getNestedState(rootState, path.slice(0, -1)) //寻找父级 state对象; path.slice(0, -1)是除去本模块后的模块层级数组
    const moduleName = path[path.length - 1]
    store._withCommit(() => { // 区分严格模式时，防止非commit方式修改state
      if (process.env.NODE_ENV !== 'production') {
        if (moduleName in parentState) { //module中 state中定义的属性名 不可以和modules中的属性名重复(state属性值会被modules覆盖)
          console.warn(`[vuex] state field "${moduleName}" was overridden by a module with the same name at "${path.join('.')}"`)
        }
      }
      Vue.set(parentState, moduleName, module.state) // parentState 无__ob__属性,所以只是简单操作(parentState[moduleName] = module.state)
    })
  }

  const local = module.context = makeLocalContext(store, namespace, path)

  module.forEachMutation((mutation, key) => {
    const namespacedType = namespace + key
    registerMutation(store, namespacedType, mutation, local)
  })

  module.forEachAction((action, key) => {
    const type = action.root ? key : namespace + key
    const handler = action.handler || action
    registerAction(store, type, handler, local)
  })

  module.forEachGetter((getter, key) => {
    const namespacedType = namespace + key
    registerGetter(store, namespacedType, getter, local)
  })

  module.forEachChild((child, key) => {
    installModule(store, rootState, path.concat(key), child, hot)
  })
}

/**
 * 
 * 创建模块内容: make localized dispatch, commit, getters and state
 * store, store 对象实例
   namespace, 模块的命名空间前缀，不管本模块是否设置命名空间，父模块设置了，也会有该值
   path，模块层级关系数组，注意，namespace与path并不一定相同，因为命名层级，只有当模块设置有命名空间(namespaced: true)，才存在对应层级命名
 */
function makeLocalContext (store, namespace, path) {
  const noNamespace = namespace === '' // 根据namespace（本模块及祖先容器是否是设置过命名空间）进行判断
  // 有设置命名空间，则往各个函数名中添加命名空间前缀
  const local = {
    dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
      //格式下参数 _type可能为一个对象, 如果_type有type属性，进行重定义 _type=_type.type, _payload=_type, _options=_payload
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      // 根据options.root判断是否往全局发送的action函数
      // 如果不是发送全局的action函数，即只发送本模块内的action函数，这是往调用的的 action函数名中，添加命名空间路径前缀
      if (!options || !options.root) {
        type = namespace + type
        if (process.env.NODE_ENV !== 'production' && !store._actions[type]) {// store._actions 没有找到 namespace + type的定义
          console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
          return
        }
      }

      return store.dispatch(type, payload)
    },

    commit: noNamespace ? store.commit : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
        type = namespace + type
        if (process.env.NODE_ENV !== 'production' && !store._mutations[type]) {
          console.error(`[vuex] unknown local mutation type: ${args.type}, global type: ${type}`)
          return
        }
      }

      store.commit(type, payload, options)
    }
  }
  // 往某对象中添加属性，并设置该数据的访问拦截器，即访问该数据时，将先调用拦截器函数
  Object.defineProperties(local, {
    getters: { // state是根据层级关系设置，getters则根据命名空间区分，与层级关系不大
      get: noNamespace? () => store.getters: () => makeLocalGetters(store, namespace)
    },
    state: { 
      get: () => getNestedState(store.state, path)
    }
  })

  return local
}

// 作用是将通过模块拿getter时，如何通过store.getters中取。是否应该添加前缀、
function makeLocalGetters (store, namespace) {   // 例：namespace = 'p1'
  if (!store._makeLocalGettersCache[namespace]) { //缓存中没有找到，进行处理并缓存； 如找到直接return
    const gettersProxy = {}
    const splitPos = namespace.length // splitPos = 2
    Object.keys(store.getters).forEach(type => {   // type是store getters全路径 p1/p2/p3
      if (type.slice(0, splitPos) !== namespace) return  // type.slice(0, slitPos) = p1
      const localType = type.slice(splitPos)  // localType = p2/p3
      Object.defineProperty(gettersProxy, localType, {
        get: () => store.getters[type],
        enumerable: true
      })
    })
    store._makeLocalGettersCache[namespace] = gettersProxy
  }

  return store._makeLocalGettersCache[namespace]
}

function registerMutation (store, type, handler, local) {
  const entry = store._mutations[type] || (store._mutations[type] = [])
  entry.push(function wrappedMutationHandler (payload) {
    handler.call(store, local.state, payload)
  })
}

function registerAction (store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = [])
  entry.push(function wrappedActionHandler (payload) {
    let res = handler.call(store, {
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload)
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }
    if (store._devtoolHook) {
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      return res
    }
  })
}

function registerGetter (store, type, rawGetter, local) {
  if (store._wrappedGetters[type]) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }
  store._wrappedGetters[type] = function wrappedGetter (store) {
    return rawGetter(
      local.state, // local state
      local.getters, // local getters
      store.state, // root state
      store.getters // root getters
    )
  }
}

// 监听树state变化(deep：true 深度递归监听)
function enableStrictMode (store) {
  store._vm.$watch(function () { return this._data.$$state }, () => {
    if (process.env.NODE_ENV !== 'production') {
      assert(store._committing, `do not mutate vuex store state outside mutation handlers.`)
    }
  }, { deep: true, sync: true })
}
// 获取指定module (path) 的state
function getNestedState (state, path) {
  return path.reduce((state, key) => state[key], state)
}

// 判断参数是否为对象，是对象则进行解析，并调整参数位置(commit dispatch方法参数 规范化)
function unifyObjectStyle (type, payload, options) {
  if (isObject(type) && type.type) {
    options = payload
    payload = type
    type = type.type
  }

  if (process.env.NODE_ENV !== 'production') {
    assert(typeof type === 'string', `expects string as the type, but found ${typeof type}.`)
  }

  return { type, payload, options }
}

// Vue.use调用安装Vuex插件调用
export function install (_Vue) {
  /*保证反复Vue.use(Vuex)只会调用一次, 
      其实vue.use方法已经做过一次保障了:
      if (installedPlugins.indexOf(plugin) > -1) {
        return this
      }
  */
  if (Vue && _Vue === Vue) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        '[vuex] already installed. Vue.use(Vuex) should be called only once.'
      )
    }
    return
  }
  Vue = _Vue //用本地全局变量保存外部传入的Vue类
  applyMixin(Vue) // 调用Vue的minix混入方法，将Vuex实例注入； 让Vue各个实例组件共享同一个$store
}
