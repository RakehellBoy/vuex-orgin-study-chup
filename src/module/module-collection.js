import Module from './module'
import { assert, forEachValue } from '../util'

export default class ModuleCollection {
  constructor (rawRootModule) {
    // register root module (Vuex.Store options)
    this.register([], rawRootModule, false)
  }

  // 获取指定路径下的module  当path=[] 返回this.root(根module)
  get (path) {
    return path.reduce((module, key) => {
      return module.getChild(key)
    }, this.root)
  }

  getNamespace (path) {
    let module = this.root
    return path.reduce((namespace, key) => {
      module = module.getChild(key)
      //配置中的modules namespaced 如没有或为false则返回 空串''
      return namespace + (module.namespaced ? key + '/' : '')
    }, '')
  }

  update (rawRootModule) {
    update([], this.root, rawRootModule)
  }

  // 自调用注册字odule 并挂在到父module._children下
  register (path, rawModule, runtime = true) { //new Vuex.stroe(xxx) 该方法静态注入时传入runtime: false; 动态注册不传默认true
    if (process.env.NODE_ENV !== 'production') {
      assertRawModule(path, rawModule)
    }

    const newModule = new Module(rawModule, runtime)
    if (path.length === 0) {
      this.root = newModule
    } else {
      const parent = this.get(path.slice(0, -1)) // path.slice(0, -1) 拿到去除path最后一位后的数组
      parent.addChild(path[path.length - 1], newModule)
    }

    // register nested modules
    if (rawModule.modules) {
      forEachValue(rawModule.modules, (rawChildModule, key) => {
        // concat只是生产一个新的数组，未对path做改动过
        this.register(path.concat(key), rawChildModule, runtime)
      })
    }
  }

  // 用于动态注入的module 可以动态注销
  unregister (path) {
    const parent = this.get(path.slice(0, -1))
    const key = path[path.length - 1]
    if (!parent.getChild(key).runtime) return

    parent.removeChild(key)
  }
}

function update (path, targetModule, newModule) {
  if (process.env.NODE_ENV !== 'production') {
    assertRawModule(path, newModule)
  }

  // 更新目标对象的原生(rawModule)的 namespaced getters mutations actions 仅且只更新这四个
  targetModule.update(newModule)

  // 递归循环更新 子modules
  if (newModule.modules) {
    for (const key in newModule.modules) {
      if (!targetModule.getChild(key)) { //原module不含改属性(即newModule有原module没有的属性， newModule可以少属性，但最好不要多出属性)
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `[vuex] trying to add a new module '${key}' on hot reloading, ` +
            'manual reload is needed'
          )
        }
        return
      }
      update(path.concat(key), targetModule.getChild(key), newModule.modules[key])
    }
  }
}




// 以下都是在做 getters mutations actions 传入错误值后给予错误提示
const functionAssert = {
  assert: value => typeof value === 'function',
  expected: 'function'
}

const objectAssert = {
  assert: value => typeof value === 'function' ||
    (typeof value === 'object' && typeof value.handler === 'function'),
  expected: 'function or object with "handler" function'
}

const assertTypes = {
  getters: functionAssert, // getters配置参数中的value需要是个 函数类型
  mutations: functionAssert, // mutations配置参数中的value需要是个 函数类型
  actions: objectAssert // action配置参数中的 value需要是个 函数 或 对象(且对象中含有属性 handler为函数类型)
}

function assertRawModule (path, rawModule) {
  Object.keys(assertTypes).forEach(key => {
    if (!rawModule[key]) return

    const assertOptions = assertTypes[key]

    forEachValue(rawModule[key], (value, type) => {
      assert(
        assertOptions.assert(value),
        // key(getters, mutations, actions), type(getters等对象的key值)， value(gettes等对象的value值)
        makeAssertionMessage(path, key, type, value, assertOptions.expected)
      )
    })
  })
}

function makeAssertionMessage (path, key, type, value, expected) {
  // 如 getters should be function but getters.xxx in module xxx.xxx is
  let buf = `${key} should be ${expected} but "${key}.${type}"`
  if (path.length > 0) {
    buf += ` in module "${path.join('.')}"`
  }
  buf += ` is ${JSON.stringify(value)}.`
  return buf
}
