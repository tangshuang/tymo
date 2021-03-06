import Parser from './ty/parser.js'
import Model from './model.js'
import { createAsyncRef } from './shared/utils.js'
import ScopeX from 'scopex'
import Validator from './validator.js'
import Factory from './factory.js'
import {
  each,
  isString,
  isFunction,
  isArray,
  isObject,
  isInstanceOf,
  isEmpty,
  parse,
} from 'ts-fns'

export class Loader {
  /**
   *
   * @param {object} json {
   *   "schema": {
   *     "name": {
   *       "default": "",
   *       "type": "string",
   *       "required()": "age > 0",
   *     },
   *     "age": {
   *       "default": 0,
   *       "type": "number",
   *     },
   *   },
   *   "state": {
   *     "is_found": false
   *   },
   *   "attrs": {},
   *   "methods": {
   *     "doSome(v)": "name = v",
   *   },
   * }
   */
  parse(json) {
    const types = this.types()
    const defs = this.defs()
    const filters = this.filters()
    const { schema, state = {}, attrs = {}, methods = {} } = json

    const loader = this
    const typeParser = new Parser(types)

    let hasDefUsed = false
    const defProxy = new Proxy(defs, {
      get(target, key, receiver) {
        if (key in defs) {
          hasDefUsed = true
        }
        return Reflect.get(target, key, receiver)
      },
    })

    const defScopex = new ScopeX(defProxy, { filters })

    const parseDefExp = (exp, scopex = defScopex) => {
      if (!exp) {
        return
      }
      if (!isString(exp)) {
        return
      }

      try {
        const value = scopex.parse(exp)
        const hasUsed = hasDefUsed
        hasDefUsed = false
        return hasUsed ? { value } : null
      }
      catch (e) {
        hasDefUsed = false
      }
    }

    const getFinalExp = (exp) => exp.trim()
      .replace(/^\.\./g, '$views.') // -> { ..a.value }
      .replace(/\.\./g, '.$views.') // -> { $parent..b.value }

    const createFn = (scopex, exp, params) => (...args) => {
      if (!params) {
        const res = parseDefExp(exp)
        if (res) {
          return res.value
        }

        const finalExp = getFinalExp(exp)
        const output = scopex.parse(finalExp)
        return output
      }

      const locals = {}
      params.forEach((param, i) => {
        const value = args[i]
        locals[param] = value
      })

      const newDefScopex = defScopex.$new(locals)
      const res = parseDefExp(exp, newDefScopex)
      if (res) {
        return res.value
      }

      const newScopex = scopex.$new(locals)
      const finalExp = getFinalExp(exp)
      const output = newScopex.parse(finalExp)
      return output
    }

    const parseKey = (str) => {
      const matched = str.match(/([a-zA-Z0-9_$]+)(\((.*?)\))?(!(.*))?/)
      const [_, name, _p, _params, _m, _macro] = matched
      const params = isString(_params) ? _params.split(',').map(item => item.trim()).filter(item => !!item) : void 0
      const macro = _m ? _macro || '' : void 0
      return [name, params, macro]
    }

    const parseGetter = (value) => {
      if (isString(value)) {
        if (/:fetch\(.*?\)/.test(value)) {
          const [_all, before, _matched, matched, after] = value.match(/(.*?):fetch\((.*?)\)(.*?)/)
          const defaultValue = tryGetExp(before)
          return createAsyncRef(defaultValue, () => {
            return loader.fetch(matched).then((data) => {
              if (data && typeof data === 'object' && after && after[0] === '.') {
                const keyPath = after.substr(1)
                return parse(data, keyPath)
              }
              else {
                return data
              }
            })
          })
        }
      }
      return value
    }

    const isInnerExp = (str) => {
      return str[0] === '{' && str[str.length - 1] === '}'
    }

    const getInnerExp = (str) => {
      return str.substring(1, str.length - 1)
    }

    const parseSubModel = (exp) => {
      if (isString(exp)) {
        const res = parseDefExp(exp)
        if (res && isInstanceOf(res.value, Model)) {
          return res.value
        }
      }
      else if (exp && !isArray(exp) && typeof exp === 'object') {
        const sub = loader.parse(exp)
        return sub
      }
    }

    class LoadedModel extends Model {
      state() {
        const stat = {}
        each(state, (value, key) => {
          stat[key] = parseGetter(value)
        })
        return stat
      }
      schema() {
        const scopex = new ScopeX(this, { filters })
        const $schema = {}
        const submodels = {}
        const factories = {}

        each(schema, (def, field) => {
          // sub model(s)
          if (/^<.+?>$/.test(field)) {
            const name = field.substring(1, field.length - 1)

            if (isArray(def)) {
              const items = def.map(item => parseSubModel(item)).filter(item => !!item)
              if (items.length) {
                submodels[name] = items
              }
            }
            else {
              const sub = parseSubModel(def)
              if (sub) {
                submodels[name] = sub
              }
            }

            return
          }

          if (!isObject(def)) {
            return
          }

          const meta = {}
          const defi = loader.meta(def)
          each(defi, (_exp, attr) => {
            const [_key, _params] = parseKey(attr)
            const [key, params, exp] = loader.attr(_key, _params, _exp)

            if (key === 'type') {
              const type = typeParser.parse(exp)
              meta.type = type
              return
            }

            if (key === 'validators') {
              if (!isArray(exp)) {
                return
              }
              const items = []

              const defaultValidators = new ScopeX(Validator, { filters })
              exp.forEach((validator, i) => {
                if (isString(validator)) {
                  // i.e. validators: [ "required('some is required!')" ]
                  const [key, params] = parseKey(validator)
                  if (Validator[key] && params) {
                    items.push(defaultValidators.parse(validator))
                  }
                  return
                }

                if (!isObject(validator)) {
                  return
                }

                const item = {}
                each(validator, (_exp, attr) => {
                  const [_key, _params] = parseKey(attr)
                  const [key, params, exp] = loader.validator(_key, _params, _exp)

                  if (isFunction(exp)) {
                    item[key] = exp
                    return
                  }

                  if (isArray(params)) {
                    const value = createFn(scopex, exp, params)
                    item[key] = value
                    return
                  }

                  item[key] = exp
                })
                items.push(item)
              })
              meta.validators = items
              return
            }

            // function attr
            /**
             * {
             *   "drop(v)": "v > 6 && age > 20"
             * }
             */
            if (isArray(params)) {
              if (!isString(exp)) { // not a string like: `"default()": {}`, it will be `default() { return {} }`
                meta[key] = () => exp
                return
              }

              const realExp = isInnerExp(exp) ? getInnerExp(exp) : exp
              const value = createFn(scopex, realExp, params)
              meta[key] = value
              return
            }

            /**
             * {
             *   "default": "content text",
             *   "type": "string",
             *   "validators": [
             *     {
             *       "determine(value)": "value > 0"
             *       "validate(value)": "value > 5",
             *       "message": "should greater then 5"
             *     }
             *   ]
             * }
             */

            if (!isString(exp)) {
              meta[key] = exp
              return
            }

            // some: "{ name.length }" -> "some()": "{ name.length }"
            if (isInnerExp(exp)) {
              const realExp = getInnerExp(exp)
              meta[key] = createFn(scopex, realExp)
              return
            }

            const res = parseDefExp(exp)
            if (res) {
              meta[key] = res.value
              return
            }

            meta[key] = parseGetter(exp)
          })

          // DEPARTED Compatible for old version
          // |submodel| sub model(s) factory, should must be used with <submodel>
          if (/^\|.+?\|$/.test(field)) {
            const key = field.substring(1, field.length - 1)
            factories[key] = meta
            return
          }

          if (!isEmpty(meta)) {
            $schema[field] = meta
          }
        })

        // factory wrapper should must come after schema finished, or schema sub model will not be ready
        each(submodels, (model, field) => {
          const attrs = factories[field] || $schema[field] // -> new version support submodel field name directly
          if (attrs) {
            $schema[field] = Factory.getMeta(model, attrs)
          }
          else {
            $schema[field] = model
          }
        })

        return $schema
      }
      attrs() {
        const originalAttrs = super.attrs()
        return { ...originalAttrs, ...attrs }
      }
    }

    each(methods, (_exp, attr) => {
      if (!isString(_exp)) {
        return
      }

      const [_key, _params] = parseKey(attr)
      if (!_params) {
        return
      }

      const [key, params, exp] = loader.method(_key, _params, _exp)

      if (isFunction(exp)) {
        LoadedModel.prototype[key] = exp
        return
      }

      if (!isString(exp)) {
        return
      }

      const isInjected = /await fetch\(.*?\)/.test(exp)
      const [_all, before, _matched, _url, after] = isInjected ? exp.match(/(.*)(await fetch\((.*?)\))(.*)/) : []

      LoadedModel.prototype[key] = function(...args) {
        const scopex = new ScopeX(this, { filters })

        if (isInjected) {
          return new Promise((resolve, reject) => {
            const url = createFn(scopex, _url, params)(...args)
            loader.fetch(url).then((data) => {
              const subScopex = scopex.$new({ __await__: data })
              const subExp = [before, '__await__', after].join('')
              const res = createFn(subScopex, subExp, params)(...args)
              resolve(res)
            }).catch(reject)
          })
        }

        const res = createFn(scopex, exp, params)(...args)
        return res
      }
    })

    return this.extend(LoadedModel) || LoadedModel
  }

  // set types
  types() {
    return {}
  }
  // set defs
  defs() {
    return {}
  }
  // set filters
  filters() {
    return {}
  }

  // you can modify json meta object here
  meta(meta) {
    return meta
  }
  // you can modify an attribute json here
  attr(key, params, exp) {
    return [key, params, exp]
  }
  // you can modify an validator json here
  validator(key, params, exp) {
    return [key, params, exp]
  }
  // you can modify a method json here
  method(key, params, exp) {
    return [key, params, exp]
  }

  // extend LoadedModel
  extend(Model) {
    return Model
  }

  // define fetch factory
  fetch(url) {
    return fetch(url).then(res => res.json())
  }

  load(url) {
    return this.fetch(url).then(json => this.parse(json))
  }

  static getModelAsync(url) {
    const Constructor = this
    return new Constructor().load(url)
  }
}
export default Loader

function tryGetExp(exp) {
  try {
    return JSON.parse(exp)
  }
  catch (e) {
    const scopex = new ScopeX({})
    try {
      return scopex.parse(exp)
    }
    catch (e) {
      return exp
    }
  }
}
