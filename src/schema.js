import {
  isObject,
  isArray,
  isFunction,
  isBoolean,
  isInstanceOf,
  isEmpty,
  each,
  map,
  clone,
  freeze,
  define,
  isString,
} from 'ts-fns'

import { Ty, Rule } from './ty/index.js'


/**
 * @example const schema = new Schema({
 *   propertyName: {
 *     // required, function to return an object/array
 *     default: '',
 *
 *     // optional, computed property, will compute at each time digest end
 *     // when it is a compute property, it is not able to use set to update value
 *     compute() {
 *       const a = this.a
 *       const b = this.b
 *       return a + '' + b
 *     },
 *
 *     // required, notice: `default` and result of `compute` should match type,
 *     // can be rule, i.e. ifexist(String)
 *     type: String,
 *
 *     // optional
 *     validators: [
 *       {
 *         determine: (value) => Boolean, // whether to run this validator, return true to run, false to forbid
 *         validate: (value) => Boolean, // whether to pass the validate, return true to pass, false to not pass and throw error
 *         message: '', // the message of error which throw when validate not pass, can be function to return message dynamicly
 *       },
 *     ],
 *
 *     // optional, function, used by `restore`, `data` is the parameter of `restore`
 *     create: (data) => !!data.on_market ? data.listing : data.pending,
 *
 *     // optional, function, whether to not use this property when invoke `jsondata` and `formdata`
 *     drop: (value, key, data) => Boolean,
 *     // optional, function, to override the property value when using `jsondata` and `formdata`, not work when `drop` is false
 *     map: (value, key, data) => newValue,
 *     // optional, function, to assign this result to output data, don't forget to set `drop` to be true if you want to drop original data
 *     flat: (value, key, data) => ({ newProp: newValue }),
 *
 *     // optional, function, format this property value when get
 *     getter: (value) => newValue,
 *     // optional, function, format this property value when set
 *     setter: (value) => value,
 *
 *     // optional, function or boolean, use schema.required(field) to check, will be invoked by validate
 *     required: () => Boolean,
 *     // optional, function or boolean, use schema.disabled(field) to check, will disable set/validate, preload before drop in formulate
 *     disabled: () => Boolean,
 *     // optional, function or boolean, use schema.readonly(field) to check, will disable set
 *     readonly: () => Boolean,
 *     // the difference between `disabled` and `readonly`:
 *     // disabled is to disable this property, so that it should not be used(shown) in your application,
 *     // readonly means the property can only be read/validate/formulate, but could not be changed.
 *
 *     // optional, when an error occurs caused by this property, what to do with the error
 *     catch: (error) => {},
 *   },
 * })
 */
export class Schema {
  constructor(defs) {
    each(defs, (def, key) => {
      define(this, key, {
        value: freeze(def),
        enumerable: true,
      })
    })
  }

  has(key) {
    return !!this[key]
  }

  default(key) {
    const { default: defaultValue } = this[key]
    return getDefaultValue(defaultValue)
  }

  required(key, context) {
    const def = this[key]

    if (!def) {
      return false
    }

    const { required, catch: handle } = def

    if (!required) {
      return false
    }

    if (isFunction(required)) {
      return !!this._trydo(
        () => required.call(context),
        (error) => isFunction(handle) && handle.call(context, error) || false,
        {
          key,
          option: 'required',
        },
      )
    }
    else {
      return !!required
    }
  }

  disabled(key, context) {
    const def = this[key]

    if (!def) {
      return false
    }

    const { disabled, catch: handle } = def

    if (!disabled) {
      return false
    }

    if (isFunction(disabled)) {
      return !!this._trydo(
        () => disabled.call(context),
        (error) => isFunction(handle) && handle.call(context, error) || false,
        {
          key,
          option: 'disabled',
        },
      )
    }
    else {
      return !!disabled
    }
  }

  readonly(key, context) {
    const def = this[key]

    if (!def) {
      return false
    }

    const { readonly, catch: handle } = def

    if (!readonly) {
      return false
    }

    if (isFunction(readonly)) {
      return !!this._trydo(
        () => readonly.call(context),
        (error) => isFunction(handle) && handle.call(context, error) || false,
        {
          key,
          option: 'readonly',
        },
      )
    }
    else {
      return !!readonly
    }
  }

  get(key, value, context) {
    const def = this[key]

    if (!def) {
      return value
    }

    const { getter, compute, catch: handle } = def
    if (isFunction(compute)) {
      const next = compute.call(context)
      return next
    }

    if (isFunction(getter)) {
      const coming = this._trydo(
        () => getter.call(context, value),
        (error) => isFunction(handle) && handle.call(context, error) || value,
        {
          key,
          option: 'getter',
        },
      )
      return coming
    }
    else {
      return value
    }
  }

  set(key, next, prev, context) {
    const def = this[key]

    if (!def) {
      return next
    }

    const { setter, compute } = def

    if (this.disabled(key, context)) {
      this.onError({
        key,
        action: 'set',
        next,
        prev,
        disabled: true,
        message: `${key} can not be set new value because of disabled.`
      })
      return prev
    }

    if (this.readonly(key, context)) {
      this.onError({
        key,
        action: 'set',
        next,
        prev,
        readonly: true,
        message: `${key} can not be set new value because of readonly.`
      })
      return prev
    }

    if (compute) {
      this.onError({
        key,
        action: 'set',
        next,
        prev,
        compute,
        message: `${key} can not be set new value because it is a computed property.`
      })
      return prev
    }

    if (isFunction(setter)) {
      const coming = this._trydo(
        () => setter.call(context, next),
        (error) => isFunction(handle) && handle.call(context, error) || prev,
        {
          key,
          option: 'setter',
        },
      )
      return coming
    }
    else {
      return next
    }
  }

  /**
   * validate type and vaidators
   * @param {*} key
   * @param {*} value
   * @param {*} context
   */
  validate(key, value, context) {
    const def = this[key]
    const errors = []

    if (!def) {
      errors.push({
        key,
        value,
        message: `Error: ${key} is not existing in schema.`,
      })
      return errors
    }

    const { type, validators = [] } = def

    // make rule works
    const target = {}
    if (value !== undefined) {
      Object.assign(target, { key: value })
    }
    const error = isInstanceOf(type, Rule) ? Ty.catch(target).by({ key: type }) : Ty.catch(value).by(type)
    if (error) {
      errors.push({
        key,
        value,
        type,
        error,
        message: `TypeError: ${key} does not match type required.`,
      })
    }

    // if required is set, it should check before validators
    if (this.required(key, context) && isEmpty(value)) {
      errors.push({
        key,
        value,
        required: true,
        message: `Error: ${key} should be required, but receive empty.`,
      })
    }

    validators.forEach((item, index) => {
      const { determine, validate, message, catch: handle } = item

      if (isBoolean(determine) && !determine) {
        return
      }

      if (isFunction(determine)) {
        const bool = this._trydo(
          () => determine.call(context, value, key),
          (error) => isFunction(handle) && handle.call(context, error) || false,
          {
            key,
            option: 'validators[' + index+ '].determine',
          },
        )
        if (!bool) {
          return
        }
      }

      const res = this._trydo(
        () => validate.call(context, value, key),
        (error) => isFunction(handle) && handle.call(context, error) || true,
        {
          key,
          option: 'validators[' + index+ '].validate',
        },
      )
      if (isBoolean(res) && res) {
        return
      }

      let msg = ''
      if (isInstanceOf(res, Error)) {
        msg = res.message
      }

      if (isFunction(message)) {
        msg = this._trydo(
          () => message.call(context, value, key, res),
          (error) => isFunction(handle) && handle.call(context, error) || msg || `${key} did not pass validators[${index}]`,
          {
            key,
            option: 'validators[' + index + '].message',
          },
        )
      }

      if (!msg && isString(message)) {
        msg = message
      }

      errors.push({
        key,
        value,
        validators: index,
        message: msg,
      })
    })

    return errors
  }

  /**
   * restore data by passed data with `create` option, you'd better to call ensure to after restore to make sure your data is fix with type
   * @param {*} data
   * @param {*} context
   */
  restore(data, context) {
    const output = map(this, (def, key) => {
      const { create, default: defaultValue } = def
      const value = data[key]

      let coming = value

      if (isFunction(create)) {
        coming = this._trydo(
          () => create.call(context, data),
          (error) => isFunction(handle) && handle.call(context, error) || value,
          {
            key,
            option: 'create',
          },
        )
      }

      if (coming === undefined) {
        coming = getDefaultValue(defaultValue)
      }

      return coming
    })
    return output
  }

  /**
   * formulate to get output data
   * @param {*} data
   * @param {*} context
   */
  formulate(data, context) {
    const patch = {}
    const output = {}

    each(this, (def, key) => {
      const { drop, map, flat, catch: handle } = def
      const value = data[key]

      if (isFunction(flat)) {
        const res = this._trydo(
          () => flat.call(context, value, key, data) || {},
          (error) => isFunction(handle) && handle.call(context, error) || {},
          {
            key,
            option: 'flat',
          },
        )
        Object.assign(patch, res)
      }

      if (isBoolean(drop) && drop) {
        return
      }

      if (isFunction(drop)) {
        const bool = this._trydo(
          () => drop.call(context, value, key, data),
          (error) => isFunction(handle) && handle.call(context, error) || false,
          {
            key,
            option: 'drop',
          },
        )
        if (bool) {
          return
        }
      }

      if (isFunction(map)) {
        const res = this._trydo(
          () => map.call(context, value, key, data),
          (error) => isFunction(handle) && handle.call(context, error) || value,
          {
            key,
            option: 'map',
          },
        )
        output[key] = res
      }
      else {
        output[key] = value
      }
    })

    const result = Object.assign(output, patch)
    return result
  }

  _trydo(fn, fallback, basic) {
    try {
      return fn()
    }
    catch (error) {
      const err = {
        ...basic,
        error,
      }
      const e = this.onError(err) || err
      return fallback(e)
    }
  }

  onError(e) {
    console.error(e)
  }
}
export default Schema

// --------------------------------------

function getDefaultValue(defaultValue) {
  if (isFunction(defaultValue)) {
    return defaultValue()
  }
  else if (isObject(defaultValue) || isArray(defaultValue)) {
    return clone(defaultValue)
  }
  else {
    return defaultValue
  }
}
