import {
  isObject,
  isInheritedOf,
  isArray,
  map,
  each,
  flat,
  flatArray,
  define,
  makeKeyChain,
  parse,
  clone,
  isInstanceOf,
  isFunction,
  assign,
  isUndefined,
  inObject,
  isNull,
  inherit,
  createProxy,
  inArray,
  remove,
} from 'ts-fns'

import _Schema from './schema.js'
import _Store from './store.js'
import { ofChain } from './shared/utils.js'

/**
 * class SomeModel extends Model {
 *   static some = {
 *     type: String,
 *     default: '',
 *   }
 * }
 *
 * @keywords: $schema, $store, $views, init,
 *            get, set, del, update, define,
 *            watch, unwatch, validate, restore,
 *            fromJSON, toJSON, toParams, toFormData,
 *            onInit, onParse, onExport,
 */
export class Model {
  constructor(data = {}) {
    const $this = this

    const convertModelToSchemaDef = (def, root) => {
      if (isArray(def)) {
        const SomeModel = def[0]
        const create = (data, i) => {
          return isInstanceOf(data, SomeModel) ? data.setParent(this, [root, i])
            : isObject(data) ? new SomeModel().setParent(this, [root, i]).fromJSON(data)
            : null
        }
        const map = (items) => items.map(create).filter(item => !!item)
        return {
          default: () => [],
          type: def,
          validators: [
            {
              validate: ms => flatArray(map(ms, m => m.validate())),
            },
          ],
          create: (data, key) => isArray(data[key]) ? map(data[key]) : [],
          mean: (ms, key) => ({ [key]: ms.map(m => m.toJSON()) }),
          map: ms => ms.map(m => m.toData()),
          setter: (v) => isArray(v) ? map(v) : [],
        }
      }
      else {
        const SomeModel = def
        const create = (data) => {
          return isInstanceOf(data, SomeModel) ? data.setParent(this, [root])
            : isObject(data) ? new SomeModel().setParent(this, [root]).fromJSON(data)
            : new SomeModel().setParent(this, [root])
        }
        return {
          default: () => create(),
          type: SomeModel,
          validators: [
            {
              validate: m => m.validate(),
            },
          ],
          create: (data, key) => create(data[key]),
          mean: (m, key) => ({ [key]: m.toJSON() }),
          map: m => m.toData(),
          setter: v => create(v),
        }
      }
    }

    /**
     * create schema
     */
    class Schema extends _Schema {
      constructor(metas) {
        const defs = map(metas, (def, key) => {
          /**
           * class SomeModel extends Model {
           *   static some = OtherModel
           * }
           */
          if (isInheritedOf(def, Model)) {
            return convertModelToSchemaDef(def, key)
          }

          /**
           * class SomeModel extends Model {
           *   static some = [OtherModel, AnyModel]
           * }
           */
          if (isArray(def) && !def.some(def => !isInheritedOf(def, Model))) {
            return convertModelToSchemaDef(def, key)
          }

          return def
        })
        super(defs)
      }
      onError(...args) {
        $this.onError(...args)
      }
    }
    // create schema
    let schema = this.schema(Schema)
    // support schema instance or object
    if (!isInstanceOf(schema, _Schema)) {
      schema = new Schema(schema)
    }
    define(this, '$schema', schema)

    /**
     * create store
     */
    class Store extends _Store {
      dispatch(keyPath, next, prev, force) {
        const notify = super.dispatch(keyPath, next, prev, force)
        // propagation
        if ($this.$parent && $this.$keyPath) {
          $this.$parent.$store.dispatch([...$this.$keyPath, ...keyPath], next, prev, true)
        }
        return notify
      }
    }
    const store = new Store()
    define(this, '$store', store)

    this.init(data)

    /**
     * support async onInit
     * i.e.
     *
     * async onInit() {
     *   const options = await this.$schema.some.getOptionsAsync()
     *   this.options = options
     * }
     *
     * async getOptions() {
     *   await this.$ready
     *   return this.options
     * }
     */
    define(this, '$ready', Promise.resolve(this.onInit()))
  }

  schema() {
    // create schema by model's static properties
    return ofChain(this, Model)
  }

  state() {
    const state = {}
    each(this.$schema, (meta) => {
      const metaState = meta.state()
      Object.assign(state, metaState)
    })
    return state
  }

  attrs() {
    // default attributes on meta, `null` to disabled
    return {
      default: null,
      compute: null,
      type: null,
      message: null,
      validators: null,
      create: null,
      mean: null,
      drop: null,
      map: null,
      flat: null,
      from: null,
      to: null,
      getter: null,
      setter: null,
      formatter: null,
      readonly: false,
      disabled: false,
      required: false,
      hidden: false,
      watch: null,
      catch: null,
      state: null,
    }
  }

  init(data) {
    if (this.$ready) {
      return
    }

    const schema = this.$schema
    const keys = Object.keys(schema)

    // patch keys to this
    keys.forEach((key) => {
      define(this, key, {
        get: () => this.get(key),
        set: (value) => this.set(key, value),
        enumerable: true,
      })
    })

    // views
    const views = {}

    keys.forEach((key) => {
      // patch attributes from meta
      const meta = this.$schema[key]
      // default attributes which will be used by Model/Schema, can not be reset by userself
      const attrs = this.attrs()
      // define a view
      const view = {
        changed: false, // whether the field has changed
      }
      // use defineProperties to define view properties
      const viewDef = {}

      each(attrs, (fallback, attr) => {
        if (isNull(fallback)) {
          return
        }
        viewDef[attr] = {
          get: () => this.$schema.$invoke(key, attr, this)(fallback),
          enumerable: true,
        }
      })

      each(meta, (descriptor, key) => {
        if (inObject(key, attrs)) {
          return
        }
        const { value, get, set } = descriptor
        if (get || set) {
          viewDef[key] = {
            get: get && get.bind(this),
            set: set && set.bind(this),
            enumerable: true,
            configurable: true,
          }
        }
        else {
          // patch to view directly
          view[key] = value
        }
      }, true)

      // unwritable mandatory view properties
      Object.assign(viewDef, {
        value: {
          get: () => this.get(key),
          set: (value) => this.set(key, value),
          enumerable: true,
        },
        errors: {
          get: () => this.$schema.$validate(key, this.$store.get(key), this)([]),
          enumerable: true,
        },
        data: {
          get: () => this.$store.get(key),
          enumerable: true,
        },
        text: {
          get: () => this.$schema.format(key, this.$store.get(key), this) + '',
          enumerable: true,
        },
        state: {
          get: () => {
            const state = isFunction(meta.state) ? meta.state() : {}
            const keys = Object.keys(state)
            const proxy = createProxy({}, {
              get: keyPath => inArray(keyPath[0], keys) ? parse(this, keyPath) : undefined,
              set: (keyPath, value) => inArray(keyPath[0], keys) && assign(this, keyPath, value),
              del: keyPath => inArray(keyPath[0], keys) && remove(this, keyPath),
            })
            return proxy
          },
          enumerable: true,
        },
      })

      Object.defineProperties(view, viewDef)

      define(views, key, {
        value: view,
        enumerable: true,
      })
    })

    define(this, '$views', views)

    // create errors, so that is's easy and quick to know the model's current status
    define(this.$views, '$errors', () => {
      const errors = []
      each(views, (view) => {
        errors.push(...view.errors)
      })
      return errors
    })

    // create changed, so that it's easy to find out whether the data has changed
    define(this.$views, '$changed', {
      get: () => keys.some((key) => this.$views[key].changed),
      set: (status) => keys.forEach(key => this.$views[key].changed = !!status)
    })

    // create $state, so that it's easy to read state from $views
    define(this.$views, '$state', () => {
      const state = this.state()
      const keys = Object.keys(state)
      const output = {}
      keys.forEach((key) => {
        define(output, key, {
          enumerable: true,
          get: () => this[key],
          set: (value) => this[key] = value,
        })
      })
      return output
    })

    // watch
    keys.forEach((key) => {
      const def = this.$schema[key]
      if (!def.watch) {
        return
      }

      this.watch(key, def.watch, true)
    })

    // init data
    this.fromJSON(data)

    // ensure top properties
    this.watch('*', ({ key }) => {
      this._ensure(key)
    })
  }

  /**
   * get field value, with formatting by `getter`
   * @param {array|string} keyPath
   */
  get(keyPath) {
    const chain = isArray(keyPath) ? [...keyPath] : makeKeyChain(keyPath)
    const key = chain.shift()

    const value = this.$store.get(key)
    const transformed = this.$schema.get(key, value, this)

    const output = parse(transformed, chain)
    return output
  }

  /**
   * set field value, with `readonly`, `disabled`, `editable`, `type` checking, and formatting by `setter`
   * @param {array|string} keyPath
   * @param {*} next
   * @param {boolean} force force set, ignore `readonly` & `disabled`
   */
  set(keyPath, next, force) {
    if (!this.$store.editable) {
      return parse(this, keyPath)
    }

    const chain = isArray(keyPath) ? [...keyPath] : makeKeyChain(keyPath)
    const key = chain.shift()

    // deep set
    if (chain.length) {
      const current = this.$store.get(key)
      const cloned = clone(current)
      assign(cloned, chain, next)
      next = cloned
    }

    const def = this.$schema[key]
    if (!def) {
      return this.define(key, next)
    }

    this._check(key)

    const prev = this.$store.get(key)
    const value = force ? this.$schema.$set(key, next, this) : this.$schema.set(key, next, prev, this)
    const coming = this.$store.set(key, value)

    this.$views[key].changed = true

    return coming
  }

  update(data) {
    if (!this.$store.editable) {
      return this
    }

    each(data, (value, key) => {
      this.set(key, value)
    })
    return this
  }

  define(key, value) {
    if (!this.$store.editable) {
      return parse(this, keyPath)
    }

    if (this.$schema[key]) {
      return this[key]
    }

    // delete this key
    if (isUndefined(value)) {
      delete this[key]
      this.$store.del(key)
      return
    }

    const def = {
      get: () => this.$store.get(key),
      configurable: true,
      enumerable: true,
    }
    if (!isFunction(value)) {
      def.set = value => this.$store.set(key, value)
    }
    Object.defineProperty(this, key, def)

    const coming = isFunction(value) ? this.$store.define(key, value) : this.$store.set(key, value)
    return coming
  }

  watch(key, fn) {
    this.$store.watch(key, fn, true, this)
    return this
  }

  unwatch(key, fn) {
    this.$store.unwatch(key, fn)
    return this
  }

  validate(key) {
    // validate all properties once together
    if (!key) {
      this._check(null, true)
      const errors = []

      const errs = this.onCheck() || []
      errors.push(...errs)

      const keys = Object.keys(this.$schema)
      keys.forEach((key) => {
        const errs = this.validate(key)
        errors.push(...errs)
      })

      return errors
    }

    if (isArray(key)) {
      const errors = []
      key.forEach((key) => {
        const errs = this.validate(key)
        errors.push(...errs)
      })
      return errors
    }

    this._check(key, true)
    const value = this.$store.get(key)
    const errors = this.$schema.validate(key, value, this)
    return errors
  }

  /**
   * reset and cover all data, original model will be clear first, and will use new data to cover the whole model.
   * notice that, properties which are in original model be not in schema may be removed.
   * @param {*} data
   */
  restore(data = {}) {
    if (!this.$store.editable) {
      return this
    }

    const schema = this.$schema
    const state = this.state()
    const params = {}

    const ensure = (value, keys) => {
      if (isArray(value)) {
        value.forEach((item, i) => ensure(item, [...keys, i]))
        return
      }

      if (!isInstanceOf(value, Model)) {
        return
      }
      value.setParent(this, keys)
    }

    // those on schema
    each(schema, (def, key) => {
      const { compute } = def
      if (compute) {
        define(params, key, {
          enumerable: true,
          get: () => compute.call(this),
        })
      }
      else if (inObject(key, data)) {
        const value = data[key]
        params[key] = value
        ensure(value, [key])
      }
      else {
        const value = schema.$default(key)
        params[key] = value
        ensure(value, [key])
      }
    })

    // patch state
    each(state, (descriptor, key) => {
      if (inObject(key, params)) {
        return
      }

      // define state here so that we can invoke this.state() only once when initialize
      define(this, key, {
        get: () => this.get(key),
        set: (value) => this.set(key, value),
        enumerable: true,
        configurable: true,
      })

      // use data property if exist, use data property directly
      if (inObject(key, data)) {
        const value = data[key]
        params[key] = value
        ensure(value, key)
        return
      }

      define(params, key, descriptor)
    }, true)

    // delete the outdate properties
    each(this.$store.state, (_, key) => {
      if (inObject(key, params)) {
        return
      }

      if (key.indexOf('$') === 0 || key.indexOf('_') === 0) {
        return
      }

      this.$store.del(key)
      delete this[key]
    }, true)

    this.onSwitch(params)

    // reset into store
    this.$store.init(params)

    return this
  }

  /**
   * use schema `create` option to generate and restore data
   * @param {*} json
   */
  fromJSON(json) {
    if (!this.$store.editable) {
      return this
    }

    const entry = this.onParse(json)
    const data = this.$schema.parse(entry, this)
    const next = { ...json, ...data }
    this.restore(next)
    return this
  }

  toJSON() {
    this._check()
    const data = clone(this.$store.state) // original data
    const output = this.$schema.record(data, this)
    const result = this.onRecord(output)
    return result
  }

  toData() {
    this._check()
    const data = clone(this.$store.state) // original data
    const output = this.$schema.export(data, this)
    const result = this.onExport(output)
    return result
  }

  toParams(determine) {
    const data = this.toData()
    const output = flat(data, determine)
    return output
  }

  toFormData(determine) {
    const data = this.toParams(determine)
    const formdata = new FormData()
    each(data, (value, key) => {
      formdata.append(key, value)
    })
    return formdata
  }

  // toEdit() {
  //   const Constructor = getConstructorOf(this)
  //   const $this = this

  //   class Editor extends Constructor {
  //     init(data) {
  //       let commits = {}
  //       let history = []
  //       let cursor = -1
  //       let doing = false
  //       define(this, '$commits', {
  //         get: () => commits,
  //         set: v => commits = v,
  //       })
  //       define(this, '$history', {
  //         get: () => history,
  //         set: v => history = v,
  //       })
  //       define(this, '$cursor', {
  //         get: () => cursor,
  //         set: v => cursor = v,
  //       })
  //       define(this, '$doing', {
  //         get: () => doing,
  //         set: v => doing = v,
  //       })

  //       super.init(data)

  //       // record all changes in history
  //       this.watch('*', ({ key, value }) => {
  //         this.$record({ key, value })
  //       }, true)
  //     }

  //     restore(data) {
  //       super.restore(data)
  //       this.clear()
  //       // create a initialized mirror
  //       this.commit('$origin')
  //       return this
  //     }

  //     undo() {
  //       if (!this.$store.editable) {
  //         return
  //       }

  //       const cursor = this.$cursor - 1

  //       // no history
  //       if (cursor < -1 || !this.$history.length) {
  //         return
  //       }

  //       // from history to none
  //       if (cursor === -1) {
  //         const origin = this.$commits.$origin
  //         const current = this.$history[0]
  //         const { key, data } = current
  //         if (data) {
  //           this.$replay({ data: origin })
  //         }
  //         else {
  //           const value = parse(origin, key)
  //           this.$replay({ key, value })
  //         }
  //       }
  //       else {
  //         const history = this.$history[cursor]
  //         this.$replay(history)
  //       }

  //       this.$cursor = cursor

  //       return this
  //     }

  //     redo() {
  //       if (!this.$store.editable) {
  //         return
  //       }

  //       const cursor = this.$cursor + 1
  //       const max = this.$history.length - 1

  //       if (cursor > max) {
  //         return
  //       }

  //       const history = this.$history[cursor]
  //       const { key, value, data } = history

  //       this.$doing = true
  //       if (data) {
  //         this.$store.update(data)
  //       }
  //       else {
  //         this.$store.set(key, value)
  //       }
  //       this.$doing = false
  //       this.$cursor = cursor

  //       return this
  //     }

  //     commit(tag) {
  //       const data = clone(this.$store.data)
  //       this.$commits[tag] = data
  //       return this
  //     }

  //     reset(tag) {
  //       if (!this.$store.editable) {
  //         return
  //       }

  //       const data = this.$commits[tag]
  //       if (!data) {
  //         return
  //       }

  //       this.$doing = true
  //       this.$store.update(data)
  //       this.$doing = false
  //       this.$record({ tag, data })

  //       return this
  //     }

  //     $record(action) {
  //       if (this.$doing) {
  //         return
  //       }

  //       const next = this.$cursor + 1
  //       this.$history.length = next // clear all items after cursor

  //       if (action.tag) {
  //         this.$history.push({
  //           time: Date.now(),
  //           data: action.data,
  //           tag: action.tag,
  //         })
  //       }
  //       else {
  //         const { key, value } = action
  //         this.$history.push({
  //           key,
  //           value,
  //           time: Date.now(),
  //         })
  //       }

  //       this.$cursor = next // move cursro to next (latest)
  //     }

  //     $replay(history) {
  //       const { key, value, data } = history
  //       this.$doing = true
  //       if (data) {
  //         this.$store.update(data)
  //       }
  //       else {
  //         this.$store.set(key, value)
  //       }
  //       this.$doing = false
  //     }

  //     clear() {
  //       this.$cursor = -1
  //       this.$history = []
  //       this.$doing = false
  //     }

  //     submit() {
  //       const data = this.$store.data
  //       const cloned = clone(data)
  //       const next = map(cloned, (node) => {
  //         if (isArray(node)) {
  //           return map(node, item => isInstanceOf(item, Model) ? item.submit() : item)
  //         }
  //         else {
  //           return isInstanceOf(node, Model) ? node.submit() : node
  //         }
  //       })
  //       $this.restore(next)
  //       return $this
  //     }
  //   }

  //   const data = this.$store.data
  //   const cloned = clone(data)
  //   const editor = map(cloned, (node) => {
  //     if (isArray(node)) {
  //       return map(node, item => isInstanceOf(item, Model) ? item.toEdit() : item)
  //     }
  //     else {
  //       return isInstanceOf(node, Model) ? node.toEdit() : node
  //     }
  //   })
  //   return new Editor(editor)
  // }

  // when initialized
  onInit() {}

  // before restore model datas
  onSwitch(params) {
    return params
  }

  // parse data before parse, should be override
  onParse(data) {
    return data
  }

  // by toJSON
  onRecord(data) {
    return data
  }

  // serialize data after export, should be override
  onExport(data) {
    return data
  }

  onCheck() {}

  onError() {}

  onEnsure() {}

  lock() {
    this.$store.editable = true
  }

  unlock() {
    this.$store.editable = false
  }

  setParent(parent, keyPath) {
    if (this.$parent && this.$parent === parent) {
      return this
    }

    define(this, '$parent', {
      value: parent,
      writable: false,
      configurable: true,
    })
    define(this, '$keyPath', {
      value: keyPath,
      writable: false,
      configurable: true,
    })

    return this
  }

  _ensure(key) {
    const add = (value, keys) => {
      if (isInstanceOf(value, Model) && !value.$parent) {
        value.setParent(this, keys)
        value.onEnsure(this)
      }
    }
    const use = (value, key) => {
      if (isArray(value)) {
        value.forEach((item, i) => add(item, [key, i]))
      }
      else {
        add(value, [key])
      }
    }

    const root = isArray(key) ? key[0] : key
    const value = this.$store.get(root)
    use(value, key)
  }

  _check(key, isValidate = false) {
    const schema = this.$schema
    const keys = key ? [key] : Object.keys(schema)

    let str = ''
    keys.forEach((key) => {
      const def = schema[key]
      each(def, (value, key) => {
        if (key === 'validators' && isValidate) {
          value.forEach((item) => {
            each(item, (value) => {
              str += isFunction(value) ? value + '' : ''
            })
          })
        }
        else {
          str += isFunction(value) ? value + '' : ''
        }
      })
    })

    if (str.indexOf('this.$parent') > -1 && !this.$parent) {
      this.onError({
        key,
        action: '$parent',
      })
    }
  }

  static extend(metas, protos) {
    const Constructor = inherit(this, protos, metas)
    return Constructor
  }

  static extract(metas, protos) {
    class Child extends Model {}

    const Parent = this

    if (metas) {
      each(metas, (meta, key) => {
        if (!meta) {
          return
        }
        const descriptor = Object.getOwnPropertyDescriptor(Parent, key)
        define(Child, key, descriptor)
      })
    }

    if (protos) {
      each(protos, (proto, key) => {
        if (!proto) {
          return
        }
        const descriptor = Object.getOwnPropertyDescriptor(Parent.prototype, key)
        define(Child.prototype, key, descriptor)
      })
    }

    if (Child.name !== Parent.name) {
      const name = Object.getOwnPropertyDescriptor(Parent, 'name')
      define(Child, 'name', {
        ...name,
        enumerable: !!metas.name,
        configurable: true,
      })
    }

    return Child
  }
}

export default Model
