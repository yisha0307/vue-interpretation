import { effect, ReactiveEffect, activeReactiveEffectStack } from './effect'
import { UnwrapNestedRefs } from './ref'
import { isFunction } from '@vue/shared'

export interface ComputedRef<T> {
  _isRef: true
  readonly value: UnwrapNestedRefs<T>
  readonly effect: ReactiveEffect
}

export interface WritableComputedRef<T> {
  _isRef: true
  value: UnwrapNestedRefs<T>
  readonly effect: ReactiveEffect
}

export interface WritableComputedOptions<T> {
  get: () => T
  set: (v: T) => void
}

export function computed<T>(getter: () => T): ComputedRef<T>
export function computed<T>(
  options: WritableComputedOptions<T>
): WritableComputedRef<T>
export function computed<T>(
  getterOrOptions: (() => T) | WritableComputedOptions<T>
): any {
  // 参数支持两种，一种是直接传个函数，一种是传个对象，对象的写法如下：
  // const plusOne = computed({
  //   get: () => n.value + 1,
  //   set: val => {
  //     n.value = val - 1
  //   }
  // })
  // 所以接下去的几句代码就是在取出函数而已
  const isReadonly = isFunction(getterOrOptions)
  const getter = isReadonly
    ? (getterOrOptions as (() => T))
    : (getterOrOptions as WritableComputedOptions<T>).get
  const setter = isReadonly
    ? null
    : (getterOrOptions as WritableComputedOptions<T>).set

  let dirty: boolean = true
  let value: any = undefined
  // computed 其实也是借助 effect 来实现在依赖的数据更新以后去调用回调
  // 如果你还没看过 effect 的代码， 推荐先去阅读它
  // 在 options 中设置了 lazy 为 true，也就是回调不会在调用 computed 时执行
  // 必须在 xx.value 以后回调才会执行并去收集依赖，看如下例子
  // const value = reactive({ num: 0 })
  // const cValue = computed(() => value.num)
  // value.num = 1
  // console.log(cValue.value)
  // 在 value.num = 1 的时候，不会触发 cValue 的回调。如果第三四行代码调换的话。value.num = 1 的时候就能触发回调
  // 虽然触不触发在 console.log 的时候都能正常拿到值
  const runner = effect(getter, {
    lazy: true,
    // mark effect as computed so that it gets priority during trigger
    computed: true,
    scheduler: () => {
      dirty = true
    }
  })
  // 包装返回值，可以调用 xx.value 或者 xx.value = xxx
  // 另外和 effect 一样，也可以暂停 computed 的计算
  // stop(xx.effect)
  // 主要还是 get 和 set 的逻辑了
  return {
    _isRef: true,
    // expose effect so computed can be stopped
    effect: runner,
    get value() {
      // 调用回调，dirty 这里要配合上面的 scheduler 一起看
      // scheduler 也是在 effect 中调用的，如果有这个属性的话，effect 会把 scheduler 放到 nextTick 去执行
      // 也就是说防止 computed 在这个 tick 多次执行
      if (dirty) {
        value = runner()
        dirty = false
      }
      // When computed effects are accessed in a parent effect, the parent
      // should track all the dependencies the computed property has tracked.
      // This should also apply for chained computed properties.
      trackChildRun(runner)
      return value
    },
    set value(newValue) {
      if (setter) {
        setter(newValue)
      } else {
        // TODO warn attempting to mutate readonly computed value
      }
    }
  }
}

function trackChildRun(childRunner: ReactiveEffect) {
  const parentRunner =
    activeReactiveEffectStack[activeReactiveEffectStack.length - 1]
  if (parentRunner) {
    for (let i = 0; i < childRunner.deps.length; i++) {
      const dep = childRunner.deps[i]
      if (!dep.has(parentRunner)) {
        dep.add(parentRunner)
        parentRunner.deps.push(dep)
      }
    }
  }
}
const value = reactive({ num: 0 })
const cValue = computed(() => value.num)
value.num = 1
