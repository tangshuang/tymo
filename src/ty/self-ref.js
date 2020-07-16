import { isFunction } from 'ts-fns'
import Type from './type.js'
import { createType } from './rules.js'

export class SelfRef extends Type {
  constructor(fn) {
    if (!isFunction(fn)) {
      throw new Error('[SelfRef]: pattern should be a function.')
    }

    super(null)

    this.fn = fn
    this.name = 'SelfRef'
    this.pattern = fn(this)
  }
  catch(value) {
    const type = createType(this.pattern)
    const error = type.catch(value)
    return error
  }
}

export function selfref(fn) {
  const type = new SelfRef(fn)
  return type.init()
}

export default SelfRef