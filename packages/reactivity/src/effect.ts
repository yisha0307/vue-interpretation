import { OperationTypes } from './operations'
// Dep: Set<ReactiveEffect>
import { Dep, targetMap } from './reactive'
import { EMPTY_OBJ, extend } from '@vue/shared'

export interface ReactiveEffect {
  (): any
  isEffect: true
  active: boolean
  raw: Function
  deps: Array<Dep>
  computed?: boolean
  scheduler?: (run: Function) => void
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
  onStop?: () => void
}

export interface ReactiveEffectOptions {
  lazy?: boolean
  computed?: boolean
  scheduler?: (run: Function) => void
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
  onStop?: () => void
}

export interface DebuggerEvent {
  effect: ReactiveEffect
  target: any
  type: OperationTypes
  key: string | symbol | undefined
}

export const activeReactiveEffectStack: ReactiveEffect[] = []

export const ITERATE_KEY = Symbol('iterate')

// 这个文件中暴露的核心函数是 effect

export function effect(
  fn: Function,
  options: ReactiveEffectOptions = EMPTY_OBJ
): ReactiveEffect {
  // 判断回调是否已经包装过
  if ((fn as ReactiveEffect).isEffect) {
    fn = (fn as ReactiveEffect).raw
  }
  // 包装回调
  const effect = createReactiveEffect(fn, options)
  // 不是 lazy 的话会直接调用一次
  if (!options.lazy) {
    effect()
  }
  // 返回值用以 stop
  return effect
}

export function stop(effect: ReactiveEffect) {
  if (effect.active) {
    cleanup(effect)
    if (effect.onStop) {
      effect.onStop()
    }
    effect.active = false
  }
}

function createReactiveEffect(
  fn: Function,
  options: ReactiveEffectOptions
): ReactiveEffect {
  // 一系列赋值操作，重点看 run 的实现
  const effect = function effect(...args): any {
    return run(effect as ReactiveEffect, fn, args)
  } as ReactiveEffect
  effect.isEffect = true
  effect.active = true
  effect.raw = fn
  effect.scheduler = options.scheduler
  effect.onTrack = options.onTrack
  effect.onTrigger = options.onTrigger
  effect.onStop = options.onStop
  effect.computed = options.computed
  // 用于收集依赖函数
  effect.deps = []
  return effect
}

function run(effect: ReactiveEffect, fn: Function, args: any[]): any {
  if (!effect.active) {
    return fn(...args)
  }
  if (activeReactiveEffectStack.indexOf(effect) === -1) {
    cleanup(effect)
    // 执行回调 push，回调执行结束 pop
    // activeReactiveEffectStack 的用处是保持依赖函数的存在
    // 举个例子：
    // const counter = reactive({ num: 0 })
    // effect(() => {
    //   console.log(counter.num)
    // })
    // counter.num = 7
    // effect 回调在执行的过程中会触发 counter 的 get 函数
    // get 函数会触发 track，在 track 函数调用的过程中会执行 effect.deps.push(dep) 并且将
    // 也就是把回调 push 到了回调的 deps 属性上
    // 这样在下次 counter.num = 7 的时候会触发 counter 的 ste 函数
    // set 函数会触发 trigger，在 trigger 函数中会 effects.forEach(run)，把需要执行的回调都执行一遍
    try {
      activeReactiveEffectStack.push(effect)
      return fn(...args)
    } finally {
      activeReactiveEffectStack.pop()
    }
  }
}

// 用于清空依赖
function cleanup(effect: ReactiveEffect) {
  const { deps } = effect
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].delete(effect)
    }
    deps.length = 0
  }
}

let shouldTrack = true

export function pauseTracking() {
  shouldTrack = false
}

export function resumeTracking() {
  shouldTrack = true
}

export function track(
  target: any,
  type: OperationTypes,
  key?: string | symbol
) {
  if (!shouldTrack) {
    return
  }
  const effect = activeReactiveEffectStack[activeReactiveEffectStack.length - 1]
  if (effect) {
    if (type === OperationTypes.ITERATE) {
      // Symbol('iterate') : 迭代
      key = ITERATE_KEY
    }
    // 这个函数做的事情就是塞依赖到 map 中，用于下次寻找是否有这个依赖
    // 另外就是把 effect 的回调保存起来
    let depsMap = targetMap.get(target)
    if (depsMap === void 0) {
      targetMap.set(target, (depsMap = new Map()))
    }
    let dep = depsMap.get(key as string | symbol)
    if (!dep) {
      depsMap.set(key as string | symbol, (dep = new Set()))
    }
    if (!dep.has(effect)) {
      dep.add(effect)
      effect.deps.push(dep)
      if (__DEV__ && effect.onTrack) {
        effect.onTrack({
          effect,
          target,
          type,
          key
        })
      }
    }
  }
}

export function trigger(
  target: any,
  type: OperationTypes,
  key?: string | symbol,
  extraInfo?: any
) {
  const depsMap = targetMap.get(target)
  if (depsMap === void 0) {
    // never been tracked
    return
  }
  const effects: Set<ReactiveEffect> = new Set()
  const computedRunners: Set<ReactiveEffect> = new Set()
  if (type === OperationTypes.CLEAR) {
    // collection being cleared, trigger all effects for target
    depsMap.forEach(dep => {
      addRunners(effects, computedRunners, dep)
    })
  } else {
    // schedule runs for SET | ADD | DELETE
    // depsMap.get(key) 取出依赖回调
    if (key !== void 0) {
      // 把依赖回调丢到 effects 中
      addRunners(effects, computedRunners, depsMap.get(key as string | symbol))
    }
    // also run for iteration key on ADD | DELETE
    if (type === OperationTypes.ADD || type === OperationTypes.DELETE) {
      const iterationKey = Array.isArray(target) ? 'length' : ITERATE_KEY
      addRunners(effects, computedRunners, depsMap.get(iterationKey))
    }
  }
  const run = (effect: ReactiveEffect) => {
    // 简单点，就是执行回调函数
    scheduleRun(effect, target, type, key, extraInfo)
  }
  // Important: computed effects must be run first so that computed getters
  // can be invalidated before any normal effects that depend on them are run.
  computedRunners.forEach(run)
  effects.forEach(run)
}

function addRunners(
  effects: Set<ReactiveEffect>,
  computedRunners: Set<ReactiveEffect>,
  effectsToAdd: Set<ReactiveEffect> | undefined
) {
  if (effectsToAdd !== void 0) {
    effectsToAdd.forEach(effect => {
      if (effect.computed) {
        computedRunners.add(effect)
      } else {
        effects.add(effect)
      }
    })
  }
}

function scheduleRun(
  effect: ReactiveEffect,
  target: any,
  type: OperationTypes,
  key: string | symbol | undefined,
  extraInfo: any
) {
  if (__DEV__ && effect.onTrigger) {
    effect.onTrigger(
      extend(
        {
          effect,
          target,
          key,
          type
        },
        extraInfo
      )
    )
  }
  if (effect.scheduler !== void 0) {
    effect.scheduler(effect)
  } else {
    effect()
  }
}
