import { isObject, toTypeString } from '@vue/shared'
import { mutableHandlers, readonlyHandlers } from './baseHandlers'

import {
  mutableCollectionHandlers,
  readonlyCollectionHandlers
} from './collectionHandlers'

import { UnwrapNestedRefs } from './ref'
import { ReactiveEffect } from './effect'

// The main WeakMap that stores {target -> key -> dep} connections.
// Conceptually, it's easier to think of a dependency as a Dep class
// which maintains a Set of subscribers, but we simply store them as
// raw Sets to reduce memory overhead.

// targetMap 存储依赖关系，类似以下结构，这个结构会在 effect 文件中被用到
// {
//   target: {
//     key: Dep
//   }
// }
// 解释下三者到底是什么：target 就是被 proxy 的对象，key 是对象触发 get 行为以后的属性
// 比如 counter.num 触发了 get 行为，num 就是 key。dep 是回调函数，也就是 effect 中调用了 counter.num 的话
// 这个回调就是 dep，需要收集起来下次使用。
export type Dep = Set<ReactiveEffect>
export type KeyToDepMap = Map<string | symbol, Dep>
export const targetMap: WeakMap<any, KeyToDepMap> = new WeakMap()

// WeakMaps that store {raw <-> observed} pairs.
// 用于存储 proxy 对象
const rawToReactive: WeakMap<any, any> = new WeakMap()
const reactiveToRaw: WeakMap<any, any> = new WeakMap()
const rawToReadonly: WeakMap<any, any> = new WeakMap()
const readonlyToRaw: WeakMap<any, any> = new WeakMap()

// WeakSets for values that are marked readonly or non-reactive during
// observable creation.
const readonlyValues: WeakSet<any> = new WeakSet()
const nonReactiveValues: WeakSet<any> = new WeakSet()

const collectionTypes: Set<any> = new Set([Set, Map, WeakMap, WeakSet])
const observableValueRE = /^\[object (?:Object|Array|Map|Set|WeakMap|WeakSet)\]$/

const canObserve = (value: any): boolean => {
  return (
    !value._isVue &&
    !value._isVNode &&
    observableValueRE.test(toTypeString(value)) &&
    !nonReactiveValues.has(value)
  )
}

// TS 解释：T 直接认为是一个类型，这个类型继承自 object。函数参数是 object，返回值类型中也用到了 object
// 不明白的话去这个类型的具体文件看我的注释
export function reactive<T extends object>(target: T): UnwrapNestedRefs<T>
export function reactive(target: object) {
  // if trying to observe a readonly proxy, return the readonly version.
  // 判断是否为 readonly
  if (readonlyToRaw.has(target)) {
    return target
  }
  // target is explicitly marked as readonly by user
  if (readonlyValues.has(target)) {
    return readonly(target)
  }
  // 不是 readonly 就创建一个响应式对象，创建出来的对象和源对象不等
  return createReactiveObject(
    target,
    rawToReactive,
    reactiveToRaw,
    mutableHandlers,
    mutableCollectionHandlers
  )
}

export function readonly<T extends object>(
  target: T
): Readonly<UnwrapNestedRefs<T>>
export function readonly(target: object) {
  // value is a mutable observable, retrive its original and return
  // a readonly version.
  if (reactiveToRaw.has(target)) {
    target = reactiveToRaw.get(target)
  }
  return createReactiveObject(
    target,
    rawToReadonly,
    readonlyToRaw,
    readonlyHandlers,
    readonlyCollectionHandlers
  )
}

// 这个函数看完这个文件就没啥重要的了
function createReactiveObject(
  target: any,
  toProxy: WeakMap<any, any>,
  toRaw: WeakMap<any, any>,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>
) {
  // 判断是不是对象
  if (!isObject(target)) {
    if (__DEV__) {
      console.warn(`value cannot be made reactive: ${String(target)}`)
    }
    return target
  }
  // target already has corresponding Proxy
  // 对象已经是 Proxy 过的了
  let observed = toProxy.get(target)
  if (observed !== void 0) {
    return observed
  }
  // target is already a Proxy
  if (toRaw.has(target)) {
    return target
  }
  // only a whitelist of value types can be observed.
  // 查看对象中的属性类型是否存在于白名单中
  if (!canObserve(target)) {
    return target
  }
  // 判断对象的构造函数得出 handlers，集合类和别的类型用到的 handler 不一样
  const handlers = collectionTypes.has(target.constructor)
    ? collectionHandlers
    : baseHandlers
  // 创建 proxy 对象，这里主要要看 handlers 的处理了
  // 所以我们去 handlers 的具体实现文件夹吧，先看 baseHandlers 的
  // 另外不熟悉 proxy 用法的，可以先熟悉下文档 https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Proxy
  observed = new Proxy(target, handlers)
  toProxy.set(target, observed)
  toRaw.set(observed, target)
  if (!targetMap.has(target)) {
    targetMap.set(target, new Map())
  }
  return observed
}

export function isReactive(value: any): boolean {
  return reactiveToRaw.has(value) || readonlyToRaw.has(value)
}

export function isReadonly(value: any): boolean {
  return readonlyToRaw.has(value)
}

export function toRaw<T>(observed: T): T {
  return reactiveToRaw.get(observed) || readonlyToRaw.get(observed) || observed
}

export function markReadonly<T>(value: T): T {
  readonlyValues.add(value)
  return value
}

export function markNonReactive<T>(value: T): T {
  nonReactiveValues.add(value)
  return value
}
