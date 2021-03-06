# Meta

A meta is a property's definition in tyshemo model.

## Usage

```js
import { Meta, Model } from 'tyshemo'

class Name extends Meta {
  static default = ''
  static type = String
  static message = 'name should be a string'
}

class Age extends Meta {
  static default = 0
  static type = Number
  static message = 'age should be a number'
}

class Person extends Model {
  static name = new Name()
  static age = new Age()
}
```

Notice in Model definition, we pass `new Name()` into class Person, however, to make it more easy to use, we can pass the Meta class into it directly:

```js
class Person extends Model {
  static name = Name
  static age = Age
}
```

Tyshemo will initialize Meta automaticly inside.

## Attributes

A property of a Meta is called `attribute` in tyshemo. A Meta is made up with attributes.

What attributes does a Meta support? The following ones are supported inside with tyshemo Model:

```js
const attrs = {
  // required, any,
  // if you need to return an object/array, you should give a function to return,
  // i.e. default() { return { name: 'some' } }
  default: '',

  // optional, computed property, will compute at each time digest end
  // when it is a compute property, it is not able to use `set` to update value
  compute() {
    const a = this.a
    const b = this.b
    return a + '' + b
  },

  // optional, when passed, `set` action will return prev value if not pass type checking
  // notice: `default` and result of `compute` should match type,
  // can be rule, i.e. equal(String)
  type: String,
  // optional, string, message to return when type checking fail
  message: '',
  // optional, if true, when the given value does not pass type checking, the value will be replace with default value or previous value
  force: Boolean,

  // optional
  validators: [
    // read more about [Validator](validator.md)
    validator,
    ...
  ],

  // optional, function, used by `fromJSON`.
  // `json` is the first parameter of `fromJSON`
  create: (value, key, json) => !!json.on_market ? json.listing : json.pending,
  // optional, function, used by `toJSON`.
  // use this to create an object which can be used by fromJSON to recover the model
  save: (value, key, data) => {
    // notice: the return value should MUST be an object, and will be patched to output object (like `flat` do), so that you can export a complext object
    return { [key]: newValue }
  },
  // optional, used by `fromJSON` and `toJSON` to read or save to property
  // ie. asset='some', tyshemo will read property from data.some, and patch save result as json.some
  // {
  //   asset: 'some',
  //   create: value => value, // value = data.some
  //   save: value => value, // json.some = value
  // }
  // notice, if you want to return custom object in create or save, dont pass asset
  asset: String,

  // optional, function, whether to not use this property when `toData`
  drop: (value, key, data) => Boolean,
  // optional, function, to override the property value when `toData`, not work when `drop` is false
  map: (value, key, data) => newValue,
  // optional, function, to assign this result to output data, don't forget to set `drop` to be true if you want to drop original property
  flat: (value, key, data) => ({ [key]: newValue }),
  // optional, submit the key to be another name, for example: { to: 'table_1.field_1' } -> { 'table_1.field_1': value }
  to: String,

  // optional, function, format this property value when set
  setter: (value) => value,
  // optional, function, format this property value when get
  getter: (value) => newValue,
  // optional, function, format this field to a text, you can read the text on `model.$views.field.text`
  formatter: (value) => text,

  // optional, function or boolean or string,
  // if `readonly` is true, you will not be able to change value by using `set` (however `assign` works)
  readonly: Boolean|Function,
  // optional, function or boolean or string,
  // if `disabled` is true, you will not be able to change value by using `set` (however `assign` works),
  // when you invoke `validate`, the validators will be ignored,
  // when you invoke `export`, the `drop` will be set to be `true` automaticly, `flat` will not work too
  disabled: Boolean|Function,
  // optional, function or boolean or string,
  // if `hidden` is true, it means you want to hide the field related ui component
  hidden: Boolean|Function,

  // optional, function or boolean or string.
  // `required` will affect validation. If `required` is false, validation will be dropped when the given value is empty. For example, schema.validate('some', null, context) -> true. Only when `required` is true, the validation will thrown out the errors when the given value is empty.
  // `Empty` rule: null|undefined|''|NaN|[]|{}
  required: Boolean|Function,
  // optional, function to determine the value is empty
  empty: Function,

  // when this field's value changed, the `watch` function will be invoke
  watch({ value }) {},

  // optional, return an object to be attached to model
  state() {
    return {
      some: 'default value',
    }
  },
  // optional, return an object which has the same structure of a schema defs object whose node should must be Meta
  // if depend on a existing field, the field in deps() will not work
  deps() {
    return {
      field_a: A_Meta, // A_Meta is a Meta which defined before
      field_b: B_Meta, // if there is another field called `field_b` on Model, this will not work
    }
  },

  // optional, when an error occurs caused by this property, what to do with the error
  catch: (error) => {},

  // any other attr name, which can be used in Model by Model.attrs method
  // notice, if it is a function, it will be used as a getter whose parameter is the key name and return value will be treated as the real value when called on view
  // i.e. some(key) { return 'real_value' } -> model.$views.field.some -> 'real_value'
  [attr]: any,
}
```

## Why?

Why we need to define a Meta interface in tyshemo? Why not use js object directly?

Because we need to reuse a Meta in different situations. For example:

```js
class Pood extends Meta {
  static name = 'pood'
  static default = ''
  static type = String
  static message = 'pood should must be a string'
}

// now I want to use pood in situationA
const PoodA = new Pood({
  default: 'a', // override meta's default attribute
})

// now I want to use pood in situationB
const PoodB = new Pood({
  default: 'b', // override meta's default attribute
})
```

When we want to reuse a Meta but without a little different with its attributes, we need to create a new Meta based on original one by changing several attributes.

There are 4 way to extend from a Meta:

1) instance

```js
const PoodA = new Pood({
  default: 'a', // override meta's default attribute
})
```

2) instance.extend

Use `extend` method of an instance.

```js
const PoodB = new Pood().extend({
  default: 'b',
})
```

3) Meta.extend

Use static `extend` method of a Meta.

```js
const PoodB = Pood.extend({
  default: 'b',
})
```

You will always use `extend` when you need to define a attribute with `this` inside:

```js
class SomeModel extends Model {
  static pooda = Pood.extend({
    default: 'a',
    readonly: true,
  })
  static poodb = Pood.extend(class { // here pass a Class, but in fact, only its static properties used
    static default = 'b'
    static required = function() {
      // here `this` point to SomeModel instance
      return this.pooda
    }
  })
}
```

4) refererece

```js
class PoodC extends Meta {
  static name = Pood.name
  static default = 'c'
  static type = Pood.type
  static message = Pood.message
}
```

In this way, you should redefine all attributes in class PoodC, although this make it more code, however definition is much more clear.

5) property

```js
// notice we do not use `static` keyword
class Pood extends Meta {
  name = 'pood'
  default = ''
  type = String
  message = 'pood should must be a string'
}

class PoodD extends Pood {
  default = 'd'
}
```

This is a smart way. Notice, we do not put a `static` keyword in the code. This makes the Pood meta work as a normal js class object. Although it is not work as what we designed, it works as what we want.

6) extends Meta

As a ES class, you can use `extends` keyword like this:

```js
class Pood extends Meta {
  static name = 'pood'
  static default = ''
  static type = String
  static message = 'pood should must be a string'
}

class PoodE extends Pood {
  static name = 'poode'
}
```

PoodE will have all attributes of Pood with own name equals 'poode'.

And another thing yous hould know, if you extends from a Meta which is extended from another upper Meta, the atrributes will be inherited in chain.

```js
class Pood extends Meta {}
class PoodA extends Pood {}
class PoodB extends PoodA {}
```

`PoodB` will have all atrributes in chain `PoodB`->`PoodA`->`Pood`.
